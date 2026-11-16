/**
 * 接收面「拉取式」日志——M2 `AI#64`：让门③（CLI/MCP）读得到串口回声。
 *
 * ## 为什么又一份接收状态（⛔ 不是平行概念，是**第二个 sink**）
 *
 * 视图那条链（`useSerialIpcEvents` → `RingBuffer` → rAF → CM6）是**消费即清**的流：`drainAll()` 一取
 * 就空，且它的订阅随视图 mount/unmount 起落（`_registerIPCListeners` 引用计数）。门③ 的 AI 要的是
 * **另一件事**：一问一答地「从某处往后读给我」——需要一个**留存 ＋ 可寻址**的窗口，且**无视图时也在收**
 * （AI 的闭环第一腿 `openPort` 常常发生在没有任何串口标签页在场的时候）。
 *
 * ⇒ 本模块 = 接收面的**第二个 sink**：自己的订阅、自己的环形日志、自己的游标。两者互不替换、互不干扰
 * ——`events.on` 给**每个订阅者各注册一条** `ipcRenderer.on`（扇出，见壳 `electron/ipc/event-system.ts`），
 * 谁都不抢谁的事件。视图的显示口径与 AI 的读数口径**同源同序**：两边收的是同一份广播。
 *
 * ## 游标语义（外部 AI 的调用契约）
 *
 * `seq` 全局单调（跨口一起涨）；游标 = 「我已消费到哪个 seq」。`readReceiveLog(since, …)` 回 `seq > since`
 * 的那批，回执里的 `cursor` = **最后一条返回项**的 seq（无返回则原样回传入的 `since`）⇒ AI 拿着
 * `cursor` 反复拉即可续读，⛔ 不必自己算偏移。
 *
 * ⚠️ **给了 `portName` 游标也一样前进**：游标是「全局面上的位置」，不是 per-port 读状态——被过滤掉的
 * 他口数据也在这条位置之前（否则换个过滤条件就会重复读到同一批）。
 *
 * ⚠️ **余量最小只是「不崩」，标量才是判据**（`PAUSED_BUFFER_MAX` 同源纪律）：容量满滚出最老 ⇒ 落后的
 * 游标读不全，`readReceiveLog` 如实回 `lost`（已滚出、你再也读不到的条数）；AI 自己有一条读不全的判路，
 * ⛔ 别在这里吞成静默。
 *
 * ## ⛔ 不落盘
 *
 * 运行期环形缓冲，池页面一 reload 即空（`seq` 从头再来）——与分屏比例同源纪律：这是运行期状态，
 * 不进设置文件、不做持久化。跨 reload 的旧游标由命令层挡下（`cursor-ahead`，见 `serialCommands.ts`）。
 */

import type { SerialDataPayload } from "@linkdesk/contracts";
import { RECEIVE_LOG_MAX } from "../constants";
import { toHexDisplay } from "../utils/text";

/** 日志里一条——给 AI 的最小充分形状（⛔ 不带显示口径的时间戳前缀/转义：那是视图的事）。 */
export interface ReceiveLogItem {
  /** 全局单调序号（1 起）——游标就是它 */
  seq: number;
  /** 来源端口（路由键，照 `payload.portName`） */
  portName: string;
  /** 解码后的行文本（wire 原样；转义/时间戳前缀只在视图渲染时加，故这里不加） */
  text: string;
  /** 同文本的 HEX 形态——与视图 HEX 栏同源（`toHexDisplay` 单点） */
  hex: string;
  /** 到达时刻（epoch ms）——AI 算时序用（显示用的格式化时间戳不在这里造） */
  ts: number;
  /**
   * 单调毫秒数（05 案 D1）——以**本口最近一次 openPort 为原点**（`notePortOpened` 记下）。
   * 跨重连能判「新数据」：重开 ⇒ 原点重记 ⇒ uptimeMs 从 0 附近重来。
   * 原点未知（口在本插件没见过打开动作，如壳侧恢复的旧口）⇒ `null`，⛔ 不猜。
   */
  uptimeMs: number | null;
}

/** 模块级可变状态唯一属主——`_receiveLog` 只在本文件声明（测试可 poke，同 `_store` 惯例）。 */
export const _receiveLog = {
  items: [] as ReceiveLogItem[],
  /** 已分配的最大序号（水位）——空日志为 0 */
  seq: 0,
  /** 订阅是否已挂上（`ensureReceiveLogSubscribed` 的幂等位） */
  subscribed: false,
  /**
   * 每口最近一次收到数据的时刻（epoch ms）——05 案 A2 `lastDataAt` / `idleMs` 的真相源。
   * `writeReceiveLog` 是唯一写手；口名照条目 `portName`（旧载荷空口名就不记——没口名算不出 per-port）。
   */
  lastDataAt: new Map<string, number>(),
  /** 每口 openPort 原点（epoch ms）——`notePortOpened` 唯一写手，`uptimeMs` 据此算 */
  openEpochs: new Map<string, number>(),
};

/**
 * 记一口的 openPort 原点（05 案 D1）——`openPortFromModule` 打开成功后调（与侧栏灯同一条链）。
 * 重开同一口 = 覆盖旧原点（uptimeMs 重来，正是「跨重连判新数据」要的形状）。
 */
export function notePortOpened(portName: string, at: number = Date.now()): void {
  if (!portName) return;
  _receiveLog.openEpochs.set(portName, at);
}

/**
 * 幂等订阅串口数据广播——入口顶层调一次（`src/index.tsx`）。返回「现在挂着吗」。
 *
 * 🔴 **进程级常驻、故意不给 unsubscribe**：池页面的寿命就是本模块的寿命（页面一 reload 连同监听器
 * 一起没，不存在泄漏）。⛔ 别把它挂进视图的引用计数生命周期——AI 的 `openPort` 往往发生在**没有任何
 * 串口标签页**的时候，挂视图 = 那时收不到，闭环第一腿直接断。
 */
export function ensureReceiveLogSubscribed(): boolean {
  if (_receiveLog.subscribed) return true;
  const s = window.linkdesk?.serial;
  if (!s?.onData) return false; // 无串口面（测试替身/非池环境）——如实说没挂上，⛔ 不假装收着
  s.onData((payload: SerialDataPayload) => {
    // 载荷类型在运行期无编译期兜底（照 useSerialIpcEvents 的容错口径）：string 兼容旧形状
    const portName = typeof payload === "string" ? "" : (payload?.portName ?? "");
    const text = typeof payload === "string" ? payload : (payload?.text ?? "");
    writeReceiveLog(portName, text);
  });
  _receiveLog.subscribed = true;
  return true;
}

/** 收一条——唯一写入咽喉（订阅回调走它；测试也走它，⛔ 别在测试里手推 `items`）。 */
export function writeReceiveLog(portName: string, text: string): void {
  const ts = Date.now();
  if (portName) _receiveLog.lastDataAt.set(portName, ts);
  _receiveLog.items.push({
    seq: ++_receiveLog.seq,
    portName,
    text,
    hex: toHexDisplay(text),
    ts,
    uptimeMs: _receiveLog.openEpochs.get(portName) != null ? ts - _receiveLog.openEpochs.get(portName)! : null,
  });
  if (_receiveLog.items.length > RECEIVE_LOG_MAX) _receiveLog.items.shift();
}

/** 缓冲里最老一条的序号——空日志回 `seq + 1`（＝「还没有任何一条」），`lost` 据此算。 */
export function receiveLogFirst(): number {
  return _receiveLog.items[0]?.seq ?? _receiveLog.seq + 1;
}

export interface ReceiveLogPage {
  items: ReceiveLogItem[];
  /** 下次该传的游标——= 最后一条返回项的 seq；无返回则原样回传入的 `since` */
  cursor: number;
  /** 已滚出缓冲、读不到的条数（> 0 = 你落后了；含他口——游标是全局面上的位置） */
  lost: number;
}

/**
 * 游标读——纯读（不改任何状态，可重复调幂等）。
 * @param since 已消费到的游标（0 = 从缓冲里最老一条读起）
 * @param limit 本次最多几条（调用方已钳好范围）
 * @param portName 只看这个口（缺省 = 所有口）
 */
export function readReceiveLog(since: number, limit: number, portName?: string): ReceiveLogPage {
  const first = receiveLogFirst();
  // 滚出段 = (since, first) 那些序号——`since + 1 .. first - 1`
  const lost = Math.max(0, first - since - 1);
  const items: ReceiveLogItem[] = [];
  for (const item of _receiveLog.items) {
    if (item.seq <= since) continue;
    if (portName && item.portName !== portName) continue;
    items.push(item);
    if (items.length >= limit) break;
  }
  return { items, cursor: items.length > 0 ? items[items.length - 1].seq : since, lost };
}

/* ── 05 案 B①：一次读命令的三种取法 ＋ 服务端过滤（⛔ 不造第二条读路——都走本函数） ── */

export interface ReceiveLogQuery {
  /** 从该游标往后读（ exclusive）——与 `tail` 二选一 */
  since?: number;
  /** 读最近 N 条（过滤后取尾）——与 `since` 二选一 */
  tail?: number;
  /** 本次最多回几条（命中数封顶；缺省不封） */
  limit?: number;
  /** 只看这个口（缺省 = 所有口） */
  portName?: string;
  /** 行文本以此开头才算命中（服务端过滤） */
  prefix?: string;
  /** 行文本匹配此正则才算命中（服务端过滤） */
  grep?: RegExp;
}

export interface ReceiveLogQueryResult {
  items: ReceiveLogItem[];
  /** 最后一条**被检查过**的 seq——过滤模式下 ≠ 最后一条命中项（换过滤条件不重复读，03 E11） */
  cursor: number;
  /** since 模式：已滚出缓冲读不到的条数；tail 模式：要了而给不出的条数（缓冲里不够） */
  lost: number;
  /** 本次检查过几条（过滤真相——AI 才知道滤掉了多少） */
  scanned: number;
  /** 命中几条（= items.length） */
  matched: number;
}

/**
 * 统一查询——since 模式与 tail 模式共用一趟检查循环；`prefix` / `grep` 是正交过滤器。
 *
 * 游标语义（05 案 B-3，两模式一致）：`cursor` = **最后一条被检查过**的 seq——
 *   - since 模式：命中数到 `limit` 就停（cursor = 最后一条命中的 seq；续读从它往后，命中的不重不漏）；
 *     检查到缓冲尾（不管有没有命中到 limit）⇒ cursor = 缓冲里最后一条的 seq；
 *   - tail 模式：整个缓冲都检查过 ⇒ cursor = 缓冲里最后一条的 seq（空缓冲 = 当前水位）。
 * `portName` 过滤**不挡 cursor**：游标是全局面上的位置（同 `readReceiveLog` 头注那条纪律）。
 */
export function queryReceiveLog(q: ReceiveLogQuery): ReceiveLogQueryResult {
  const portName = q.portName;
  const matches = (item: ReceiveLogItem): boolean => {
    if (portName && item.portName !== portName) return false;
    if (q.prefix && !item.text.startsWith(q.prefix)) return false;
    if (q.grep && !q.grep.test(item.text)) return false;
    return true;
  };

  if (q.tail !== undefined) {
    const candidates = _receiveLog.items.filter(matches);
    const n = Math.min(q.tail, candidates.length);
    const items = candidates.slice(candidates.length - n);
    return {
      items,
      // 整个缓冲都检查过——cursor 是全局面上的位置（尾部；空缓冲 = 水位）
      cursor: _receiveLog.items.length > 0 ? _receiveLog.items[_receiveLog.items.length - 1].seq : _receiveLog.seq,
      // 要了 N 条只给得出 n 条 = 差额如实（滚出的 + 从没收到的，在 tail 口径里分不出也不必分）
      lost: Math.max(0, q.tail - candidates.length),
      scanned: _receiveLog.items.length,
      matched: items.length,
    };
  }

  const since = q.since ?? 0;
  const first = receiveLogFirst();
  const lost = Math.max(0, first - since - 1);
  const items: ReceiveLogItem[] = [];
  let cursor = since;
  let scanned = 0;
  for (const item of _receiveLog.items) {
    if (item.seq <= since) continue;
    // 无论命中与否，「检查过」就记进 scanned；cursor 停在最后检查过的那条
    scanned++;
    cursor = item.seq;
    if (!matches(item)) continue;
    items.push(item);
    if (q.limit !== undefined && items.length >= q.limit) break;
  }
  return { items, cursor, lost, scanned, matched: items.length };
}
