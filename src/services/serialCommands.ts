/**
 * 插件级命令注册——**入口顶层**执行的那批「不需要视图在场」的命令。
 *
 * ## 为什么单独一处（M2 `AI#23`）
 *
 * `views/SerialMonitorView/useViewCommands.ts` 里那批命令**住在视图**（拷贝/清空/导出日志…要
 * `getActiveCmd()` 的 CM6 实例），随视图 mount 注册、随最后一个标签页关闭被
 * `unregisterCommands("serial-monitor")` **粗粒度**摘掉——那是对的（视图没了，视图态命令就该没）。
 *
 * 但端口与会话是**插件级**状态（`_openPorts` / `_store.sessions` 是模块级单例，视图只是读者）
 * ⇒ 「打开端口 / 关端口 / 关会话 / 设发送编码 / 发送」这些动作**不依赖任何视图在场**，
 * 命令 handler 必须常驻。收在本文件，由 `src/index.tsx` 入口顶层调用。
 *
 * `AI#64` 起还包括**接收面读数**（`readSince` / `receiveStatus`）——同一判据：AI 的调试闭环
 * 「开端口 → 发 → **读回声** → 算下一组参数 → 再发」四腿里有三腿落在本文件，读数腿读的是
 * `services/receiveLog.ts` 的模块级日志（同样与视图无关，见该文件头注）。
 *
 * `AI#67` 起再包括**会话寻址**（`listSessions` ＋ 六条会话态开关）——外部 AI 在 0.2.25 复测里
 * 报的「开关按不动」实证是**会话不可寻址**（多串口下会话是多条并立的，命令面却只有「活跃会话」
 * 一个隐含目标）⇒ 读面加 `listSessions`（有哪几条、谁是活跃、每条现况），写面给六条开关收
 * `sessionId`。同一判据：会话表是模块级单例，改它不需要视图在场——所以这批也住本文件。
 *
 * `AI#68` 再收三处「猜靶子／认错人」的尾巴（外部 AI 在 0.2.26 复测里逼出）：`openPort` 多会话下
 * 不许拿「当前活跃会话」当靶子（那会改绑它的口，而活跃会话随前台标签页变——同一条命令两种结果）；
 * `closePort` 回执认**口的属主**（旧面报的是解析出来的会话 ⇒ 关 48 的 COM3 却报 49）；六条开关的
 * 标题不再按状态翻转（一个命令 id 一个标题槽，状态却是每条会话各自的 ⇒ 那个标题按构造不可靠）。
 *
 * ## 🔴 作者契约（E6#62e on-command 激活）
 *
 * 无视图时 AI 经 `exec` 打到一条池内没注册的命令 → 池 preload 会 `import()` 属主插件入口
 * （`resolvePluginViewLoader`）→ **入口顶层副作用**在这里把 handler 注册进去 → 重试一次即命中。
 * 模块缓存 ⇒ 本函数在**每次页面加载只跑一次**；视图卸载时的粗粒度 unregister 会把它一并摘掉，
 * 故 `useViewCommands` 的 cleanup 里**原样再调一次**（见该文件）。
 *
 * ## ⛔ 命令本体不许绕插件
 *
 * 每个 handler 都走插件自己的写入咽喉（`openPortFromModule` / `closePortFromModule` /
 * `getters.ts` 的会话咽喉）——即侧栏灯（`_writePortState`）、会话表、per-port 计数一起动的那条链。
 * 直调 `linkdesk.serial.openPort` 会让「口开了、灯不亮、会话面板不知道」，那是新的不一致。
 *
 * ## 说明与参数只写在声明面（`plugin.json`）
 *
 * `meta` 只带 `title` / `category` / `when`（显示面与面板门控，本仓既有惯例）；
 * **`description` / `params` 一律只写在 `plugin.json` 的 `contributes.commands[]`**——
 * 壳加载器（M1 AI#7）会把声明面这两项注册进命令索引，且池侧重注册**不带它们时不会抹掉**声明面那份
 * （`registerPoolCommandMetadata` 的「有值才覆盖」）。两处都写 = 两份文案迟早分叉，`getCommands()`
 * 里到底哪份赢还得查实现——所以只留一份。⛔ 别在这里补回 description/params。
 */

import i18n from "i18next";
import type { SerialSession } from "../hooks/useSerialSessions";
import {
  createSessionModule, getActiveSessionId, getSessionById, getSessions,
  removeSessionById, updateSessionById,
} from "../hooks/useSerialSessions";
import {
  SERIAL_CODINGS, SEND_MODE_HEX, SEND_MODE_TEXT, RECEIVE_LOG_MAX, RECEIVE_READ_LIMIT_DEFAULT, RECEIVE_READ_LIMIT_MAX,
  REOPEN_GAP_MS, WAIT_POLL_MS, WAIT_DEVICE_CHECK_TICKS, WAIT_TIMEOUT_MS_MAX,
  RESET_HOLD_MS_DEFAULT, RESET_HOLD_MS_MAX, RESET_METHOD_DTR, RESET_METHOD_RTS, RESET_METHOD_BOTH,
} from "../constants";
import { getOpenPorts, hasOpenPort } from "./SerialContext/store";
import {
  closePortFromModule, openPortFromModule, refreshPortsFromModule,
} from "./SerialContext/ipc";
import type { PortInfo } from "./SerialContext/types";
// AI#64：接收面读数（游标式拉取）——日志属主在 receiveLog，本文件只做参数归一 ＋ 回执成形
// 05 案起读数走 queryReceiveLog（since/tail/过滤一躺循环）；readReceiveLog 留给旧测试与兼容
import { _receiveLog, queryReceiveLog, receiveLogFirst } from "./receiveLog";
import type { ReceiveLogItem } from "./receiveLog";
// AI#67：会话寻址读数要报「这条会话此刻有没有挂载视图」（视图态命令的可用性）——_cmdMap 是那个事实的属主
import { _cmdMap } from "./commandBridge";

/** 端口/帧格式入参——`linkdeskctl exec serial-monitor.openPort '{"portName":"COM3","baudRate":115200}'` */
export interface OpenPortArgs {
  /** 端口名（COM3 / /dev/ttyUSB0…）——缺省用会话里已绑的；会话也没有则取第一个可用口（同手点「打开」） */
  portName?: string;
  /** 波特率（数字）——缺省用会话里存的（无会话 115200） */
  baudRate?: number;
  /** 帧格式：数据位 / 停止位 / 校验（none|odd|even）——缺省用会话里存的（8N1） */
  dataBits?: number;
  stopBits?: number;
  parity?: string;
  /** 端口解码编码（接收编码）——缺省用会话里存的 */
  encoding?: string;
  /** 指定会话（缺省：当前活跃会话；一个都没有则新建一个） */
  sessionId?: string;
}

export interface PortTargetArgs {
  portName?: string;
  sessionId?: string;
}

/** 05 案 C-1 `mark` 入参 */
export interface MarkArgs {
  /** 游标名（非空）——同名覆盖，回执带 previous 旧游标 */
  name?: string;
  /** 上下文会话（缺省不绑会话——游标本身是全局面上的位置） */
  sessionId?: string;
}

/** 05 案 C-4 `query` 入参——发 ＋ 等应答，一次调用 */
export interface QueryArgs {
  /** 要发的指令（文本，按会话发送编码走 sendText） */
  send?: string;
  /** 等的应答（**子串匹配**——AT 指令的应答里常有正则元字符，字面子串更不会误伤） */
  expect?: string;
  /** 等待上限（毫秒，必填）——须小于 CLI/命令层超时 */
  timeoutMs?: number;
  portName?: string;
  sessionId?: string;
}

/** 05 案 E-1 `reset` 入参——DTR/RTS 电气复位 */
export interface ResetArgs {
  /** 复位法：dtr | rts | both（both = 同相同步拉） */
  method?: string;
  /** 拉低时长（毫秒，缺省 100） */
  holdMs?: number;
  portName?: string;
  sessionId?: string;
}

export interface CloseSessionArgs {
  /** 会话 id（缺省：活跃会话） */
  sessionId?: string;
  /** 会话名（无 id 时按名字找） */
  name?: string;
  /** 已确认——跳过确认框（程序化调用方：AI 侧确认归壳侧敏感回路，见 AI#29） */
  confirm?: boolean;
}

export interface SetCodingArgs {
  /** 发送编码——取值限于 SERIAL_CODINGS */
  coding?: string;
  sessionId?: string;
}

/** 接收面拉取入参——`linkdeskctl exec serial-monitor.readSince '{"since":0,"limit":50}'` */
export interface ReadSinceArgs {
  /** 游标——上一次回执里的 `cursor`；**缺省（没传任何取法参数）不再回放历史**，改回 `cursor-required`（05 案 B-1）；显式 0 = 要整个缓冲 */
  since?: number;
  /** 本次最多取几条（1–1000，缺省 200）——超上限**钳到上限并回 truncated:true**（05 案 B-4/E13），不再报坏参 */
  limit?: number;
  /** 只看这个口（缺省 = 所有口）——⚠️ 游标按全局面上的位置前进，不受过滤影响 */
  portName?: string;
  /** 读最近 N 条（与 since / afterMark 互斥，05 案 B-2）——不受 limit 上限约束，仍受缓冲容量约束 */
  tail?: number;
  /** 从命名游标之后读（与 since / tail 互斥，05 案 C-2）——mark 不存在 ⇒ ENOMARK */
  afterMark?: string;
  /** 行前缀过滤（服务端；游标照常前进，回执带 scanned/matched，05 案 B-3） */
  prefix?: string;
  /** 行正则过滤（服务端；同上） */
  grep?: string;
  /** 阻塞等一行命中（服务端，05 案 C-3）——**timeoutMs 必填**（⛔ 不设无限等）；可叠加 since/afterMark 定起点 */
  untilRegex?: string;
  /** untilRegex / query 的等待上限（毫秒）——须小于 CLI/命令层超时，否则命令层先超时看不到 timedOut */
  timeoutMs?: number;
}

/**
 * 归一 `readSince` 入参——两形等价：逐位 `(since, limit, portName)` 与单具名对象 `{…}`。
 *
 * 照 `AI#52` 窄口：壳在**声明了 ≥2 个 params** 时按声明序展开具名对象，但「只传一个键」这类形状
 * 仍可能整包落进 `args[0]` ⇒ 这里自己认一次，两形行为一致（照壳侧 `readCommands.pickStringArg` 同款）。
 * ⚠️ 新取法（tail / afterMark / prefix / grep / untilRegex）只在**具名对象形**里有——逐位形只保留
 * 旧三参（05 案 B① 的加宽不破坏旧调用方）。
 */
function normalizeReadArgs(since?: unknown, limit?: unknown, portName?: unknown): ReadSinceArgs {
  if (since !== null && typeof since === "object" && !Array.isArray(since)) {
    const o = since as Record<string, unknown>;
    return {
      since: o.since as number, limit: o.limit as number, portName: o.portName as string | undefined,
      tail: o.tail as number, afterMark: o.afterMark as string | undefined,
      prefix: o.prefix as string | undefined, grep: o.grep as string | undefined,
      untilRegex: o.untilRegex as string | undefined, timeoutMs: o.timeoutMs as number | undefined,
    };
  }
  return { since: since as number, limit: limit as number, portName: portName as string | undefined };
}

/**
 * 坏参/坏目标回执的形状——**载荷里出声**，⛔ 不抛异常。
 *
 * 两条判例：① 壳侧读数命令（`AI#62` `readCommands.ts`）：抛异常会变成用户可见的红色 toast，而
 * 「AI 参数写错了」这件事用户当场什么也做不了；② 读命令的 `undefined`/空回执正是 `AI#62` 要消灭的
 * 「答不上却看着像答了」⇒ 必须出声，但出在**调用方读的那一层**（回执载荷）。
 *
 * ⚠️ `AI#67` 起**读命令与会话寻址命令共用**这一个成形处（原名 `badReadArg`——寻址腿进来后名字
 * 只剩一半真，改名 `badArg`）：`{ok:false, noop:true, reason}` 三件套是本插件对外的统一坏回执。
 */
export interface BadReply {
  ok: false;
  noop: true;
  reason: string;
  error: string;
}
export function badArg(reason: string, error: string): BadReply {
  return { ok: false, noop: true, reason, error };
}

/** 现有会话的可读清单——报「找不到」时要能顺便告诉对方**有哪些**（⛔ 别让调用方再来问一次）。
 *  `AI#68` 起带上**各自绑的口**与活跃标记：多会话下「这条会话是哪个口」正是调用方要判的东西
 *  （真机上就是靠它把 48↔COM3 / 49↔COM4 对上），也是「不打名就打活跃会话」那条拒信的依据。 */
function describeSessions(): string {
  const all = getSessions();
  if (all.length === 0) return "（一条都没有）";
  const active = getActiveSessionId();
  return all
    .map((s) => `${s.name}[${s.id}]→${s.port || "未绑口"}${s.id === active ? "（活跃）" : ""}`)
    .join("、");
}

/**
 * 「按 id 找不到会话」的措辞——**一处来源**：`addressSession`（载荷口径）与**抛异常口径**的既有命令
 * （`openPort`/`closePort`/`setSendCoding`/`quickSendDelete`）共用，⛔ 别各写一句（两份迟早分叉）。
 */
function sessionNotFoundError(sessionId: string): Error {
  return new Error(`找不到会话 "${sessionId}"——现有：${describeSessions()}（会话清单看 serial-monitor.listSessions）`);
}

/**
 * 寻址到「要动的那条会话」——M2 `AI#67` 会话寻址的**唯一入口**（六条开关 ＋ 视图侧暂停开关共用）。
 *
 * 语义（与既有 `resolveSession` 的显式 id → 活跃 → 第一条一致）：
 *   - 给了 `sessionId` ⇒ 只认它（找不到**如实报**并列出有哪些，⛔ 不静默回退到活跃会话——
 *     那会让「我改了会话2」变成「我改了别的会话」，正是本条要消灭的形状）；
 *   - 没给 ⇒ 活跃会话；没有活跃 ⇒ 第一条（`AI#23` 以来的缺省语义，旧行为不变）；
 *   - 一条会话都没有 ⇒ 坏回执 `no-session`（⛔ 不偷偷建——建会话语义归 `openPort`）。
 */
export function addressSession(sessionId?: unknown): { session: SerialSession } | BadReply {
  if (sessionId !== undefined && sessionId !== null && sessionId !== "") {
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return badArg(
        "bad-session",
        `sessionId 必须是非空字符串（收到 ${JSON.stringify(sessionId)}）——会话清单看 serial-monitor.listSessions`,
      );
    }
    const found = getSessionById(sessionId.trim());
    if (!found) return badArg("bad-session", sessionNotFoundError(sessionId).message);
    return { session: found };
  }
  const active = getActiveSessionId();
  const session = (active ? getSessionById(active) : undefined) ?? getSessions()[0];
  if (!session) {
    return badArg("no-session", "当前一条会话都没有——先 serial-monitor.openPort 建一条（会话清单看 serial-monitor.listSessions）");
  }
  return { session };
}

/**
 * 从命令实参里取 `sessionId`——两形等价：单具名对象 `{sessionId:"…"}`（声明面的那一种）
 * 与逐位字符串 `("…")`。照 `AI#62` 壳侧 `pickStringArg` 的先例（arity=1 时壳的具名展开不开）。
 */
export function readSessionId(args: unknown[]): unknown {
  const first = args[0];
  if (first !== null && typeof first === "object" && !Array.isArray(first)) {
    return (first as Record<string, unknown>).sessionId;
  }
  return first;
}

/* ══ 05 案（门外 AI 契约补齐）共用基建 ══
   A 组状态可信 / B① 缓冲查询 / C 等待原语 / E 复位——回执形状照 02-方案与契约 §〇：
   成功 `{ok:true,…}`；noop `{ok:true,noop:true,reason}`（沿用 badArg 三件套）；失败 `{ok:false,code,error,hint?}`。
   `reason`（noop，"我没动，因为没必要"）与 `code`（失败，"我做不到"）分工不同——⛔ 别混用。 */

/** 05 案统一失败回执——`code` 照 02 §五错误码表（ENOSESSION/ENOPORT/EDEVICE/EALREADYOPEN/ENOMARK/EBUSY/ESENDFAIL/EBADARGS） */
export interface CodeFail {
  ok: false;
  code: string;
  error: string;
  hint?: string;
}
export function failCode(code: string, error: string, hint?: string): CodeFail {
  return hint !== undefined ? { ok: false, code, error, hint } : { ok: false, code, error };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ── 05 案 C-1：命名游标（marks）——插件内存，reload 即失效（与 receiveLog 同一条「不落盘」纪律） ── */
export interface MarkEntry {
  /** 打点时的全局游标（_receiveLog.seq 水位） */
  cursor: number;
  /** 打点时点名（或缺省解析到）的会话——纯上下文回执用，游标本身是全局面上的位置 */
  sessionId: string | null;
  ts: number;
}
/** `_marks` 只在本文件声明（模块级 mutable 单一属主纪律）；测试可 poke/clear。 */
export const _marks = new Map<string, MarkEntry>();

/** 05 案 C-4：在等应答的口——同口并发 query ⇒ EBUSY（⛔ 不排队：两条指令的时序会错乱）。 */
export const _queryBusy = new Set<string>();

/**
 * 设备在场清单（05 案 A 组的 `devicePresent` 判据）——插件自己枚举硬件面（`serial.listPorts`，
 * 与界面「端口」下拉同一条腿）。拉不到（无 serial 面 / 读失败）⇒ `null`：**读不到的值如实 null，
 * ⛔ 不猜**（⛔ 不拿本地 `_openPorts` 顶替硬件面——那是「软件以为」，不是「设备在不在」）。
 */
async function presentPortNames(): Promise<Set<string> | null> {
  const s = window.linkdesk?.serial;
  if (!s?.listPorts) return null;
  try {
    const ports = (await s.listPorts()) ?? [];
    return new Set(ports.map((p) => p.name));
  } catch { return null; }
}

/**
 * 05 案 A1/A6：某口绑的会话此刻的**视图暂停态**——没挂视图 ⇒ `null`（⛔ 不报 false 假装问过，
 * 与 listSessions 的 paused 同一口径）。视图暂停只冻结**显示**，AI 读数链（receiveLog）不受影响
 * ——T0 已核实（receiveLog.ts 写入咽喉无条件），故这里只报可见性，不报「丢失」。
 */
function pausedForPort(portName: string | null): boolean | null {
  if (!portName) return null;
  for (const s of getSessions()) {
    if (s.port !== portName) continue;
    const cmd = _cmdMap.get(s.id);
    if (cmd) return cmd.paused;
  }
  return null;
}

/** 05 案 A-1：读取面随行的 state 块。portName 定不下来（没给且推不出唯一口）⇒ `null`，⛔ 不猜。 */
export interface PortReadState {
  paused: boolean | null;
  portOpen: boolean | null;
  devicePresent: boolean | null;
}
async function buildPortState(portName: string | null): Promise<PortReadState | null> {
  if (!portName) return null;
  const present = await presentPortNames();
  return {
    paused: pausedForPort(portName),
    portOpen: hasOpenPort(portName),
    devicePresent: present ? present.has(portName) : null,
  };
}

/**
 * `readSince` 没给 portName 时推「唯一口」——恰有一条绑口会话时用它（唯一 ⇒ 不是猜），
 * 多口/无口 ⇒ null（调用方自己点名 portName）。
 */
function resolveDefaultPort(): string | null {
  const bound = new Set(getSessions().map((s) => s.port).filter((p): p is string => Boolean(p)));
  return bound.size === 1 ? [...bound][0] : null;
}

/** 05 案 C-3：服务端阻塞等一行——命中即回；**超时是正常结局**（`{ok:true, matched:false, timedOut:true}`）；
 *  等待中设备被拔 ⇒ 立即 EDEVICE（03 E19，⛔ 不傻等到超时）。 */
async function waitUntilLine(o: { re: RegExp; startSeq: number; portName?: string; timeoutMs: number }): Promise<unknown> {
  const t0 = Date.now();
  let cursor = o.startSeq;
  let tick = 0;
  for (;;) {
    const page = queryReceiveLog({ since: cursor, limit: 1, portName: o.portName, grep: o.re, dir: "rx" });
    if (page.matched > 0) {
      const hit = page.items[0];
      return { ok: true, matched: true, line: hit.text, seq: hit.seq, portName: hit.portName, cursor: hit.seq, tookMs: Date.now() - t0, scanned: page.scanned };
    }
    cursor = page.cursor;
    const elapsed = Date.now() - t0;
    if (elapsed >= o.timeoutMs) {
      return { ok: true, matched: false, timedOut: true, cursor, tookMs: elapsed, scanned: page.scanned };
    }
    if (++tick % WAIT_DEVICE_CHECK_TICKS === 0 && o.portName) {
      const present = await presentPortNames();
      if (present !== null && !present.has(o.portName)) {
        return { ok: false, code: "EDEVICE", error: `等待期间设备消失（${o.portName} 已不在串口清单里）`, tookMs: Date.now() - t0 };
      }
    }
    await sleep(WAIT_POLL_MS);
  }
}

/** 05 案 C-4 的等应答半步——子串匹配，沿途收下本口收到的所有行（超时也带回，03 E17） */
async function waitExpect(o: { port: string; startSeq: number; expect: string; timeoutMs: number }): Promise<unknown> {
  const t0 = Date.now();
  let cursor = o.startSeq;
  const lines: ReceiveLogItem[] = [];
  let tick = 0;
  for (;;) {
    const page = queryReceiveLog({ since: cursor, portName: o.port, limit: RECEIVE_READ_LIMIT_MAX, dir: "rx" });
    cursor = page.cursor;
    if (page.items.length > 0) {
      lines.push(...page.items);
      const hit = page.items.find((it) => it.text.includes(o.expect));
      if (hit) {
        return { ok: true, matched: true, line: hit.text, lines, elapsedMs: Date.now() - t0, cursor: hit.seq };
      }
    }
    const elapsed = Date.now() - t0;
    if (elapsed >= o.timeoutMs) {
      return { ok: true, matched: false, timedOut: true, lines, elapsedMs: elapsed, cursor };
    }
    if (++tick % WAIT_DEVICE_CHECK_TICKS === 0) {
      const present = await presentPortNames();
      if (present !== null && !present.has(o.port)) {
        return { ok: false, code: "EDEVICE", error: `等待应答期间设备消失（${o.port}）`, elapsedMs: Date.now() - t0 };
      }
    }
    await sleep(WAIT_POLL_MS);
  }
}

/* ── M2 `AI#67`：会话态开关的**定义表**（handler 只写一遍） ──
 *
 * 🔴 为什么集中成表：原先七条开关的 handler 手写在 `views/SerialMonitorView/useToggleCommands.ts`
 *    里（连标题刷新一起，七块 × 2 处）。会话寻址进来后 handler 必须与「视图在不在场」解耦——
 *    外面 AI 要点名改的那条会话**可能根本没开标签页**（会话表是模块级单例，比标签页活得久）
 *    ⇒ handler 搬到插件级（本文件常驻注册），视图只留「按当前态换标题」。
 *
 * ⚠️ `AI#68` 把标题改成**与状态无关**的一句动作名（「切换…」），并**删掉视图侧的按态重注册**——
 *    命令面板标题是**一个命令 id 一个槽**（全局共享），而状态是**每条会话各自的**：多挂一个串口
 *    标签页就多一个写手，谁都可能把槽写成自己那条会话的状态 ⇒ 那个标题**按构造就不可靠**
 *    （真机复现：活跃会话的开关明明是「开」，标题却读成「关闭…」）。读状态走 `listSessions`
 *    或开关回执的 `value`；标题只说「这条命令干嘛」。⛔ 别再把 `current` 塞回标题。
 */
export type SessionToggleField = "sendMode" | "showEcho" | "showLineNumbers" | "separateSystemLog" | "autoRepeat" | "autoClear";

export interface SessionToggleSpec {
  /** 命令 id */
  id: string;
  /** 被翻转的会话字段——回执里用 `field` 回显它（⛔ 不用动态键：调用方要能稳定读到字段名） */
  field: SessionToggleField;
  /** 命令面板标题的 i18n key——`AI#68` 起**与状态无关**（固定一句动作名），理由见下面定义表的头注 */
  title: string;
  /** 由「当前值」算「新值」 */
  next: (current: unknown) => unknown;
}

const flipBool = (v: unknown) => v !== true;
const altSendMode = (v: unknown) => (v === SEND_MODE_HEX ? SEND_MODE_TEXT : SEND_MODE_HEX);

export const SESSION_TOGGLES: readonly SessionToggleSpec[] = [
  {
    id: "serial-monitor.toggleSendMode",
    field: "sendMode",
    title: "切换发送格式（文本 / HEX）",
    next: altSendMode,
  },
  {
    id: "serial-monitor.toggleEcho",
    field: "showEcho",
    title: "切换消息回显",
    next: flipBool,
  },
  {
    id: "serial-monitor.toggleLineNumbers",
    field: "showLineNumbers",
    title: "切换行号显示",
    next: flipBool,
  },
  {
    id: "serial-monitor.toggleSystemLog",
    field: "separateSystemLog",
    title: "切换系统消息独立显示",
    next: flipBool,
  },
  {
    id: "serial-monitor.toggleAutoRepeat",
    field: "autoRepeat",
    title: "切换自动重发",
    next: flipBool,
  },
  {
    id: "serial-monitor.toggleAutoClear",
    field: "autoClear",
    title: "切换自动清屏",
    next: flipBool,
  },
];

/** 取某条开关的**固定**标题 key（与状态无关）——插件级注册与视图态重注册共用同一处措辞 */
export function sessionToggleTitleKey(id: string): string {
  const spec = SESSION_TOGGLES.find((s) => s.id === id);
  return spec ? spec.title : id;
}

/**
 * 翻转一条开关（**按 id 定目标会话**）——回执带 `field` / `previous` / `value`。
 *
 * 🔴 回执给「改后的值」是本次的要点之一：旧面只回 `undefined`，门外 AI 只能从**命令面板标题**
 *    反推状态（标题兼职当读数）——外部 AI 0.2.25 复测里那条误判就是这么来的。
 *    回读走会话表（写入咽喉当场生效）⇒ 回执里的 `value` 是**读回来的**，不是「我打算写的那个」。
 */
async function runSessionToggle(spec: SessionToggleSpec, args: unknown[]): Promise<unknown> {
  const target = addressSession(readSessionId(args));
  if (!("session" in target)) return target;
  const { session } = target;
  const previous = session[spec.field];
  updateSessionById(session.id, { [spec.field]: spec.next(previous) } as Partial<SerialSession>);
  const after = getSessionById(session.id);
  return {
    ok: true,
    sessionId: session.id,
    name: after?.name ?? session.name,
    field: spec.field,
    value: after ? after[spec.field] : spec.next(previous),
    previous,
  };
}

/** 六条开关的 handler——**按 id 取同一条**（插件级注册与视图态标题重注册共用一处实现） */
export const SESSION_TOGGLE_HANDLERS: Record<string, (...args: unknown[]) => Promise<unknown>> =
  Object.fromEntries(SESSION_TOGGLES.map((spec) => [spec.id, (...args: unknown[]) => runSessionToggle(spec, args)]));

/** 会话解析——显式 id → 活跃会话 → 第一个会话；都没有返回 null（不偷偷建，交给调用点决定） */
function resolveSession(sessionId?: string): SerialSession | null {
  if (sessionId) return getSessionById(sessionId) ?? null;
  const active = getActiveSessionId();
  return (active ? getSessionById(active) : undefined) ?? getSessions()[0] ?? null;
}

/** 帧格式 + 握手电平——照 ControlPanel 的派生口径（会话字段 → openPort 实参） */
function sessionPortOptions(session: SerialSession) {
  return {
    baudRate: Number(session.baudRate || 115200),
    encoding: session.receiveCoding,
    frame: {
      dataBits: session.dataBits ?? 8,
      stopBits: session.stopBits ?? 1,
      parity: session.parity ?? "none",
    },
    handshake: { dtr: Boolean(session.dtr), rts: Boolean(session.rts) },
  };
}

/**
 * 注册插件级命令——幂等（重注册只顶替 handler/meta），入口顶层与视图卸载后各调一次。
 * @returns 注册成功的条数（测试/自省用）
 */
export function registerSerialCommands(): number {
  const reg = window.linkdesk?.commands?.registerCommand;
  if (!reg) return 0;
  const cat = i18n.t("串口监视器");
  const whenActive = "activeEditor == 'serial-monitor'";

  /* ── 打开端口（选 COM ＋ 波特率 ＋ 帧格式）── */
  reg(
    "serial-monitor.openPort",
    async (args?: OpenPortArgs) => {
      const a = args ?? {};
      // 🔴 `AI#68`：**多会话下不打名，靶子就是「谁在前台」**——下面的 `patch.port = a.portName` 会改绑
      //    那条会话的口，而活跃会话随用户切标签页变（真机复现：同一条 `openPort {"portName":"COM4"}`
      //    落到哪条会话，取决于调用瞬间前台是谁——用户切一下标签页，结果就变了）。
      //    这类「行为取决于调用瞬间」的写对无人值守的 AI 不可推理 ⇒ **拒**，并把「现有哪几条、各自
      //    绑谁、谁是活跃」一次说全（⛔ 不猜、⛔ 不默认打活跃会话）。
      //    ⚠️ 不带 portName 的调用不受影响：那时靶子就是「当前这条」，与手点侧栏「打开」同义（没有改绑）。
      if (a.portName && !a.sessionId && getSessions().length > 1) {
        throw new Error(
          `多会话下给 portName 必须点名 sessionId（现有：${describeSessions()}）`
          + "——只给 portName 会改绑「当前活跃会话」的口，而活跃会话随前台标签页变（同一条命令两种结果）；"
          + "各会话当前绑的口与 id 看 serial-monitor.listSessions",
        );
      }
      let session = resolveSession(a.sessionId);
      // 🔴 AI#67：**显式点名了会话却没命中 ⇒ 如实报错**（⛔ 别顺手新建一条——那会把「我要开会话2」
      // 变成「多出一条会话」，正是本系列反复消灭的「账面无错、其实做错了别的」）。
      if (!session && a.sessionId) throw sessionNotFoundError(a.sessionId);
      // 一个会话都没有 → 建一个（同 useSession 的自动建会话语义——否则「打开端口」在空插件上无处落）
      if (!session) session = createSessionModule(i18n.t("会话"));
      const previousPortName = session.port || null; // `AI#68`：改绑前那个口——回执要说清「这一笔动没动绑定」
      const patch: Partial<SerialSession> = {};
      if (a.portName) patch.port = a.portName;
      if (a.baudRate !== undefined) patch.baudRate = String(a.baudRate);
      if (a.dataBits !== undefined) patch.dataBits = Number(a.dataBits);
      if (a.stopBits !== undefined) patch.stopBits = Number(a.stopBits);
      if (a.parity) patch.parity = a.parity;
      if (a.encoding) patch.receiveCoding = a.encoding;
      if (Object.keys(patch).length > 0) updateSessionById(session.id, patch);
      let next = getSessionById(session.id)!;
      if (!next.port) {
        // 无端口 → 取第一个可用口（与 ControlPanel 打开按钮同判据：口列表空的就如实报错）
        const ports = await refreshPortsFromModule();
        if (ports.length === 0) {
          throw new Error("没有可用串口——请先插上设备，或用 portName 指定端口");
        }
        updateSessionById(session.id, { port: ports[0].name });
        next = getSessionById(session.id)!;
      }
      const portName = next.port;
      const opts = sessionPortOptions(next);
      if (hasOpenPort(portName)) {
        // 05 案 A-5：先辨「真开着」还是「僵尸句柄」——判据 devicePresent（插件自己枚举硬件面）。
        // 02 工程原话的「openPort 报『已被打开』绕 4~5 个来回」就是这一格在撒谎。
        const present = await presentPortNames();
        if (present !== null && !present.has(portName)) {
          // 表里开着、设备不在 ⇒ 僵尸句柄：清掉（灯灭＋权威态注销），如实报 EDEVICE——⛔ 不再回 alreadyOpen 撒谎
          await closePortFromModule(portName);
          return failCode("EDEVICE",
            `设备不在（${portName} 已从串口清单消失）而本插件还占着句柄——已把僵尸句柄清掉`,
            "设备插回后 serial-monitor.reopen 一步恢复；端口号可能变，先 serial-monitor.listPorts 核对");
        }
        // 设备在场（或硬件面读不到，不猜）：真开着——不动（本命令是「打开」不是「翻转」，关有 closePort），
        // 如实回读不假装刚开。若怀疑句柄已死而设备还在（拔插的另一种残留），用 serial-monitor.reopen 显式重开。
        return {
          opened: false, alreadyOpen: true, sessionId: next.id, portName, previousPortName,
          baudRate: opts.baudRate,
        };
      }
      await openPortFromModule({ portName, ...opts });
      return {
        opened: true, sessionId: next.id, portName, previousPortName, baudRate: opts.baudRate,
        encoding: opts.encoding ?? null, frame: opts.frame,
      };
    },
    { title: i18n.t("打开端口"), category: cat, when: whenActive },
  );

  /* ── 关闭端口 ── */
  reg(
    "serial-monitor.closePort",
    async (args?: PortTargetArgs) => {
      const session = resolveSession(args?.sessionId);
      // 🔴 AI#67：点名了会话却没命中 ⇒ 如实报「找不到会话」——⛔ 别退化成「未指定端口」那种
      // 答非所问（调用方按 sessionId 点名的，就得告诉它那个 id 的问题）
      if (!session && args?.sessionId) throw sessionNotFoundError(args.sessionId);
      const portName = args?.portName ?? session?.port ?? "";
      if (!portName) {
        throw new Error("未指定端口——会话也没绑端口（给 portName 或先选口）");
      }
      // 🔴 `AI#68`：回执里的 `sessionId` = **这个口的属主**，⛔ 不再是「解析出来的那条会话」。
      //    旧面报的是后者（缺省 = 活跃会话）——真机上关 48 的 COM3，回执却报 49：AI 拿回执复验
      //    「我关的是 48 那条会话的口吗」会被误导。属主查不到（口开着但没有会话绑它）就如实报 null。
      const ownerId = getSessions().find((s) => s.port === portName)?.id ?? null;
      // 点名了却没点到属主 ⇒ 两条都报（「这个口属于谁」＋「你要的是谁」），⛔ 别让它以为点到了
      const asked = args?.sessionId && args.sessionId !== ownerId ? { requestedSessionId: args.sessionId } : {};
      if (!hasOpenPort(portName)) {
        return { closed: false, alreadyClosed: true, portName, sessionId: ownerId, ...asked };
      }
      await closePortFromModule(portName);
      return { closed: true, portName, sessionId: ownerId, ...asked };
    },
    { title: i18n.t("关闭端口"), category: cat, when: whenActive },
  );

  /* ── 关闭串口会话（侧栏那颗 hover ✕ 的命令化）── */
  reg(
    "serial-monitor.closeSession",
    async (args?: CloseSessionArgs) => {
      const session = args?.sessionId
        ? getSessionById(args.sessionId)
        : args?.name
          ? getSessions().find((s) => s.name === args.name)
          : resolveSession();
      if (!session) {
        // 显式 id 没命中 ⇒ 有 id 就报那个 id（带上现有清单）——够不到 id 时才是一句「都没命中」
        if (args?.sessionId) throw sessionNotFoundError(args.sessionId);
        const names = getSessions().map((s) => s.name).join("、") || "（无）";
        throw new Error(`找不到会话（name 没命中；现有：${names}；会话清单看 serial-monitor.listSessions）`);
      }
      const isOpen = hasOpenPort(session.port);
      // 与手点同一条确认口径（配置 serial-monitor.confirmOnClose，默认开）
      let promptOnClose = true;
      try {
        promptOnClose = (await window.linkdesk?.configuration?.get?.("serial-monitor.confirmOnClose")) !== false;
      } catch { /* 读配置失败按默认开——宁多提示勿静默断口 */ }
      if (promptOnClose && !args?.confirm) {
        const message = isOpen
          ? i18n.t("会话正在使用 {{port}}，将断开连接", { port: session.port })
          : i18n.t("关闭会话「{{name}}」？", { name: session.name });
        const confirmed = await window.linkdesk?.dialog?.confirm?.(message);
        if (!confirmed) {
          // 用户没点头 = 不做，且**如实报**（不是 ok:true + closed:false 那种「账面无错、实际没做」的形状）
          return { closed: false, denied: true, sessionId: session.id, name: session.name };
        }
      }
      // 顺序照 useSessionCrud.handleDelete：先断口 → 关标签页 → 删会话（视图侧那三行逐字对齐）
      if (isOpen) await closePortFromModule(session.port);
      window.linkdesk?.tabs?.closeBySourceId?.(session.id);
      removeSessionById(session.id);
      return {
        closed: true, sessionId: session.id, name: session.name,
        portDisconnected: isOpen, remaining: getSessions().length,
      };
    },
    { title: i18n.t("关闭串口会话"), category: cat, when: whenActive },
  );

  /* ── 发送编码切换（侧栏「发送编码」下拉的命令化）── */
  reg(
    "serial-monitor.setSendCoding",
    async (args?: SetCodingArgs) => {
      const coding = args?.coding;
      if (!coding) throw new Error(`缺少 coding——可选：${SERIAL_CODINGS.join(" / ")}`);
      if (!(SERIAL_CODINGS as readonly string[]).includes(coding)) {
        // 取值限于下拉那一套——否则会造出「命令设得进、下拉选不出」的新不一致
        throw new Error(`不支持的编码 "${coding}"——可选：${SERIAL_CODINGS.join(" / ")}`);
      }
      const session = resolveSession(args?.sessionId);
      if (!session && args?.sessionId) throw sessionNotFoundError(args.sessionId);
      if (!session) throw new Error("没有会话可设——先用 openPort 建会话，或给 sessionId");
      updateSessionById(session.id, { sendCoding: coding });
      return { sessionId: session.id, sendCoding: coding, sendMode: session.sendMode };
    },
    { title: i18n.t("设置发送编码"), category: cat, when: whenActive },
  );

  /* ── 发送（E3j #79 老命令 + AI#10 补编码实参）── */
  reg(
    "serial-monitor.send",
    async (sendMode: "text" | "hex", data: string, portName?: string, encoding?: string) => {
      if (!data) return { sent: false, reason: "空内容" };
      const s = window.linkdesk?.serial;
      if (!s) throw new Error("串口能力不可用（window.linkdesk.serial 缺失）");
      // 编码优先级：显式实参 → 目标会话的发送编码 → utf-8。
      // ⚠️ portName 不传时仍走 D2 缺省唯一口语义（⛔ 不改成「活跃会话的口」——旧调用方/工作台卡片
      //   是无口上下文的，改了就是行为变更）。
      const targetSession = portName
        ? getSessions().find((x) => x.port === portName)
        : resolveSession();
      const enc = encoding ?? targetSession?.sendCoding ?? "utf-8";
      if (sendMode === SEND_MODE_HEX) {
        const bytes = data.split(/[\s,]+/).filter(Boolean).map((h: string) => parseInt(h, 16));
        await s.sendData(bytes, portName);
        return { sent: true, mode: SEND_MODE_HEX, bytes: bytes.length, portName: portName ?? null };
      }
      await s.sendText(data, enc, portName);
      return { sent: true, mode: "text", encoding: enc, portName: portName ?? null };
    },
    { title: i18n.t("发送"), category: cat, when: "false" },
  );

  /* ── 快捷发送：删除（右键菜单那条的常驻腿——无视图也能删）── */
  reg(
    "serial-monitor.quickSendDelete",
    async (...args) => {
      const ctx = args[0] as { quickSendName?: string; sessionId?: string } | undefined;
      const key = ctx?.quickSendName;
      if (!key) throw new Error("缺少 quickSendName——要删哪一颗快捷发送");
      const session = resolveSession(ctx?.sessionId);
      if (!session && ctx?.sessionId) throw sessionNotFoundError(ctx.sessionId);
      if (!session) throw new Error("没有会话可删快捷发送");
      if (!(key in session.quickSends)) {
        return { deleted: false, reason: "该会话没有这颗快捷发送", key, sessionId: session.id };
      }
      const updated = { ...session.quickSends };
      delete updated[key];
      // 唯一写入入口（§3.12）：经会话咽喉落回会话——与 QuickSendBar 的 saveQuickSends 同一处数据
      updateSessionById(session.id, { quickSends: updated });
      return { deleted: true, key, sessionId: session.id, remaining: Object.keys(updated).length };
    },
    { title: i18n.t("删除"), category: cat, when: whenActive },
  );

  /* ── 快捷发送：编辑——T9 收敛：编辑态住视图 ⇒ 只由视图注册（无视图调用由壳回 EVIEWREQUIRED）── */

  /* ── 接收面读数·拉取（M2 AI#64——门③ 读得到串口回声；05 案 B① 加宽取法，仍只此一个读口）──
     回执三态（与壳 AI#55/AI#60、插件侧 AI#56 同口径，⛔ 不是「ok 就是干成了」）：
       有新数据 `{ok:true, items, cursor, count, lost}` ／ 没有新的 `{ok:true, noop:true, reason:"no-new-data"}`
       ／ 调用本身不成立 `{ok:false, noop:true, reason:"bad-since"|…|no-serial-face}` 或 `{ok:false, code:"E…"}`（05 案失败形）
     取法三选一（互斥，05 案 B-1）：`since`（游标）/ `tail`（最近 N 条）/ `afterMark`（命名游标）；
     `prefix` / `grep` 是正交过滤器（游标照常前进，回 scanned/matched）。
     **缺省（连 since:0 都没显式给）⇒ `cursor-required`**——⛔ 不再回放 200 行历史（01 工程把旧日志当新现象的根）。
     回执随行 `state:{paused, portOpen, devicePresent}`（05 案 A-1/A6；口定不下来 ⇒ null）。 */
  reg(
    "serial-monitor.readSince",
    async (...raw: unknown[]) => {
      const a = normalizeReadArgs(raw[0], raw[1], raw[2]);
      if (!_receiveLog.subscribed) {
        return {
          ok: false, noop: true, reason: "no-serial-face",
          error: "串口能力不可用（window.linkdesk.serial 缺失）——接收日志没挂上，读不到任何数据",
        };
      }
      // 05 案 B-1：三种取法互斥；tail 与 untilRegex 也不可同给（一个读尾一个等新行，语义不相容）
      const modeCount = [a.since !== undefined, a.tail !== undefined, a.afterMark !== undefined].filter(Boolean).length;
      if (modeCount > 1 || (a.tail !== undefined && a.untilRegex !== undefined)) {
        return { ...badArg("mode-conflict", `since / tail / afterMark 三种取法互斥（tail 也不可与 untilRegex 同给）——一次只给一个（收到 ${JSON.stringify({ since: a.since, tail: a.tail, afterMark: a.afterMark })}）`), code: "EBADARGS" };
      }
      // 05 案 C-2：命名游标先解析（它是 since 的来源之一）
      let markSeq: number | undefined;
      if (a.afterMark !== undefined) {
        if (typeof a.afterMark !== "string" || !a.afterMark.trim()) {
          return badArg("bad-aftermark", `afterMark 必须是非空字符串（收到 ${JSON.stringify(a.afterMark)}）——先 serial-monitor.mark {"name":"…"}`);
        }
        const mark = _marks.get(a.afterMark.trim());
        if (!mark) {
          return failCode("ENOMARK",
            `命名游标 "${a.afterMark.trim()}" 不存在——marks 存插件内存（池页面 reload 即失效）`,
            "先 serial-monitor.mark {name} 打点");
        }
        markSeq = mark.cursor;
      }
      const since = a.since ?? markSeq;
      // 05 案 B-1：缺省（三种取法都没给）⇒ 不再有副作用——如实说缺游标，把当前水位给出去
      if (since === undefined && a.tail === undefined && a.untilRegex === undefined) {
        const state0 = await buildPortState(a.portName?.trim() || resolveDefaultPort());
        return {
          ok: true, noop: true, reason: "cursor-required", cursor: _receiveLog.seq,
          hint: "传 since（上次回执的 cursor）/ tail（最近 N 条）/ afterMark（命名游标）之一；要整个缓冲显式传 since:0",
          ...(state0 ? { state: state0 } : {}),
        };
      }
      if (since !== undefined && (typeof since !== "number" || !Number.isInteger(since) || since < 0)) {
        return badArg("bad-since", `since 必须是非负整数（收到 ${JSON.stringify(a.since)}）——要整个缓冲显式传 since:0`);
      }
      if (a.tail !== undefined && (typeof a.tail !== "number" || !Number.isInteger(a.tail) || a.tail < 1)) {
        return badArg("bad-tail", `tail 必须是 ≥1 的整数（收到 ${JSON.stringify(a.tail)}）`);
      }
      // 05 案 B-4/E13：limit 超上限 ⇒ 钳到上限并如实回 truncated（⛔ 不静默截）；坏类型 / <1 照旧拒
      let truncated = false;
      const rawLimit = a.limit ?? RECEIVE_READ_LIMIT_DEFAULT;
      if (a.limit !== undefined && (typeof a.limit !== "number" || !Number.isInteger(a.limit) || a.limit < 1)) {
        return badArg("bad-limit", `limit 必须是 ≥1 的整数（收到 ${JSON.stringify(a.limit)}）`);
      }
      const limit = rawLimit > RECEIVE_READ_LIMIT_MAX ? (truncated = true, RECEIVE_READ_LIMIT_MAX) : rawLimit;
      if (a.portName !== undefined && a.portName !== null && (typeof a.portName !== "string" || !a.portName.trim())) {
        return badArg("bad-port", "portName 必须是非空字符串（缺省 = 所有口）");
      }
      // 05 案 B-3：prefix / grep——正交过滤器（服务端做，游标照常前进）
      if (a.prefix !== undefined && (typeof a.prefix !== "string" || !a.prefix)) {
        return badArg("bad-prefix", `prefix 必须是非空字符串（收到 ${JSON.stringify(a.prefix)}）——不要过滤就别传`);
      }
      let grepRe: RegExp | undefined;
      if (a.grep !== undefined) {
        if (typeof a.grep !== "string" || !a.grep) return badArg("bad-grep", "grep 必须是非空正则字符串——不要过滤就别传");
        try { grepRe = new RegExp(a.grep); } catch (e) {
          return badArg("bad-grep", `grep 不是合法正则（${e instanceof Error ? e.message : String(e)}）`);
        }
      }
      if (since !== undefined && since > _receiveLog.seq) {
        // 池页面一 reload，序号从头再来 ⇒ 上一轮的游标会「超过水位」；此时若照常回空，AI 会以为
        // 「没有新数据」而永远读不到东西（seq 要从 1 长过旧游标才恢复）——如实报，并给出可用的游标。
        return {
          ok: false, noop: true, reason: "cursor-ahead", cursor: _receiveLog.seq,
          error: `游标 ${since} 超过当前水位 ${_receiveLog.seq}——接收日志已重启（池页面重载，序号从头再来）或这条游标不是本插件给的；用回执里的 cursor 重新拉`,
        };
      }
      // 05 案 C-3：untilRegex——服务端阻塞等一行（timeoutMs 必填，⛔ 不设无限等）
      if (a.untilRegex !== undefined) {
        if (typeof a.untilRegex !== "string" || !a.untilRegex) return badArg("bad-until", "untilRegex 必须是非空正则字符串");
        if (a.timeoutMs === undefined || typeof a.timeoutMs !== "number" || !Number.isInteger(a.timeoutMs) || a.timeoutMs < 1 || a.timeoutMs > WAIT_TIMEOUT_MS_MAX) {
          return badArg("bad-timeout", `untilRegex 必须配 timeoutMs（1–${WAIT_TIMEOUT_MS_MAX} 毫秒的整数，⛔ 不设无限等）——收到 ${JSON.stringify(a.timeoutMs)}；⚠️ timeoutMs 要小于 CLI/命令层超时，否则命令层先超时看不到 timedOut`);
        }
        let re: RegExp;
        try { re = new RegExp(a.untilRegex); } catch (e) {
          return badArg("bad-until", `untilRegex 不是合法正则（${e instanceof Error ? e.message : String(e)}）`);
        }
        return await waitUntilLine({ re, startSeq: since ?? _receiveLog.seq, portName: a.portName?.trim() || undefined, timeoutMs: a.timeoutMs });
      }
      const portName = a.portName?.trim() || undefined;
      const filtered = a.prefix !== undefined || grepRe !== undefined;
      const page = queryReceiveLog({ since, tail: a.tail, limit, portName, prefix: a.prefix || undefined, grep: grepRe });
      // 05 案 A-1/A6：state 随行——点名口最准；没点名且恰有一条绑口会话也能定；再多口 ⇒ null（⛔ 不猜）
      const state = await buildPortState(portName ?? resolveDefaultPort());
      if (page.items.length === 0 && a.tail === undefined) {
        return {
          ok: true, noop: true, reason: "no-new-data", items: [], cursor: page.cursor, lost: page.lost,
          ...(filtered ? { scanned: page.scanned, matched: 0 } : {}),
          ...(truncated ? { truncated: true } : {}),
          ...(state ? { state } : {}),
        };
      }
      return {
        ok: true, items: page.items, cursor: page.cursor, count: page.items.length, lost: page.lost,
        // 05 案 B-1/B-2：显式 since:0（要整个缓冲）与 tail 都是「历史」取法——如实标（旧当新是 01 工程的误判根）
        ...(since === 0 || a.tail !== undefined ? { history: true } : {}),
        ...(filtered ? { scanned: page.scanned, matched: page.matched } : {}),
        ...(truncated ? { truncated: true } : {}),
        ...(state ? { state } : {}),
      };
    },
    { title: i18n.t("读取接收数据"), category: cat, when: "false" },
  );

  /* ── 接收面水位读数（AI 先问「有没有数据 / 口还开着吗」再拉）──
     口开态读**主进程**（`serial.getStatus()` 是真源）：插件本地的 `_openPorts` 只反映本插件见过的
     开/关，池页面 reload 后会漏；拉不到（无该 API）才退回本地集合——⛔ 别拿本地集合顶替真源。 */
  reg(
    "serial-monitor.receiveStatus",
    async () => {
      if (!_receiveLog.subscribed) {
        return {
          ok: false, noop: true, reason: "no-serial-face",
          error: "串口能力不可用（window.linkdesk.serial 缺失）——接收日志没挂上",
        };
      }
      let openPorts: string[] | null = null;
      try {
        const statuses = await window.linkdesk?.serial?.getStatus?.();
        if (Array.isArray(statuses)) {
          openPorts = statuses.map((s) => s?.portName).filter((p): p is string => Boolean(p));
        }
      } catch { /* 读口态失败不阻断裂读数——下面按本地集合兜底 */ }
      if (openPorts === null) openPorts = [...getOpenPorts()];

      // 05 案 A-1/A-2：设备在场（插件自己枚举硬件面；读不到 ⇒ null 不猜）＋ 每口时点
      const present = await presentPortNames();
      const now = Date.now();
      const counts = new Map<string, number>();
      for (const item of _receiveLog.items) counts.set(item.portName, (counts.get(item.portName) ?? 0) + 1);
      const ports = new Map<string, {
        portName: string; count: number; open: boolean;
        devicePresent: boolean | null; lastDataAt: number | null; idleMs: number | null;
        state: { paused: boolean | null; portOpen: boolean; devicePresent: boolean | null };
      }>();
      const entryFor = (portName: string, count: number, open: boolean) => {
        const lastDataAt = _receiveLog.lastDataAt.get(portName) ?? null;
        const devicePresent = present ? present.has(portName) : null;
        return {
          portName, count, open, devicePresent, lastDataAt,
          idleMs: lastDataAt !== null ? now - lastDataAt : null,
          // 05 案 A-1：state 随行——paused 没挂视图 ⇒ null（⛔ 不报 false 假装问过）
          state: { paused: pausedForPort(portName), portOpen: open, devicePresent },
        };
      };
      for (const [portName, count] of counts) ports.set(portName, entryFor(portName, count, openPorts.includes(portName)));
      // 开着但一条都没收到（或他口）的口也列出来——AI 才能分辨「口没开」与「开了但设备没说话」
      for (const portName of openPorts) {
        if (!ports.has(portName)) ports.set(portName, entryFor(portName, 0, true));
      }
      // 05 案 A-2 顶层时点：全局面最近一次收到数据的时刻（多口取最近）
      let lastDataAt: number | null = null;
      for (const v of _receiveLog.lastDataAt.values()) {
        if (lastDataAt === null || v > lastDataAt) lastDataAt = v;
      }
      return {
        ok: true,
        cursor: _receiveLog.seq,
        first: receiveLogFirst(),
        count: _receiveLog.items.length,
        capacity: RECEIVE_LOG_MAX,
        lastDataAt,
        idleMs: lastDataAt !== null ? now - lastDataAt : null,
        ports: [...ports.values()],
      };
    },
    { title: i18n.t("接收面水位"), category: cat, when: "false" },
  );

  /* ── 05 案 A-4：reopen——拔插后一步恢复（closePort → 等一小段 → openPort，同一会话同参数）──
     02 工程原话「拔插一次 USB 后……花了 4~5 个来回」的正面解药：设备不在就如实 EDEVICE，
     ⛔ 不做自动重连轮询（02 §六①——只在调用时检测）。 */
  reg(
    "serial-monitor.reopen",
    async (args?: PortTargetArgs) => {
      const a = args ?? {};
      const session = resolveSession(a.sessionId);
      if (!session && a.sessionId) throw sessionNotFoundError(a.sessionId);
      const portName = a.portName ?? session?.port ?? "";
      if (!portName) {
        return failCode("ENOPORT", "未指定端口，会话也没绑端口——给 portName 或先 openPort",
          "先 serial-monitor.listPorts 挑口，再 serial-monitor.listSessions 拿 sessionId");
      }
      // 「同一会话同参数」——参数（波特率/帧格式/编码）从属主会话读起；点名 portName 而无会话绑它 ⇒ 没有可恢复的参数
      const owner = session ?? getSessions().find((s) => s.port === portName) ?? null;
      if (!owner) {
        return failCode("ENOSESSION", `端口 ${portName} 没有绑在任何会话上——reopen 按「同一会话同参数」恢复，参数无从读起`,
          "先 serial-monitor.openPort 建会话（它会把参数存进会话）");
      }
      const wasOpen = hasOpenPort(portName);
      // 设备不在就别白折腾——如实 EDEVICE（02 A-4）
      const present = await presentPortNames();
      if (present !== null && !present.has(portName)) {
        return failCode("EDEVICE", `设备不在（${portName} 不在串口清单里）——插回后再 reopen`,
          "端口号可能变，先 serial-monitor.listPorts 核对 COM 号");
      }
      const t0 = Date.now();
      if (wasOpen) await closePortFromModule(portName);
      await sleep(REOPEN_GAP_MS);
      const okOpen = await openPortFromModule({ portName, ...sessionPortOptions(owner) });
      if (!okOpen) {
        throw new Error(`重开 ${portName} 失败——串口能力不可用或打开被拒（可能被其他程序占用，EALREADYOPEN 的口子）`);
      }
      return { ok: true, sessionId: owner.id, portName, recovered: true, reopened: wasOpen, tookMs: Date.now() - t0 };
    },
    { title: i18n.t("重开端口"), category: cat, when: "false" },
  );

  /* ── 05 案 C-1：mark——命名游标（插件内存，reload 即失效；同名覆盖回 previous）── */
  reg(
    "serial-monitor.mark",
    async (args?: MarkArgs) => {
      const a = args ?? {};
      if (typeof a.name !== "string" || !a.name.trim()) {
        return badArg("bad-name", `name 必须是非空字符串（收到 ${JSON.stringify(a.name)}）——给游标起个名，如 "boot-start"`);
      }
      const name = a.name.trim();
      let sessionId: string | null = null;
      if (a.sessionId !== undefined && a.sessionId !== null) {
        const target = addressSession(a.sessionId);
        if (!("session" in target)) return target;
        sessionId = target.session.id;
      }
      const cursor = _receiveLog.seq;
      const previous = _marks.get(name)?.cursor ?? null;
      _marks.set(name, { cursor, sessionId, ts: Date.now() });
      return { ok: true, name, cursor, sessionId, previous };
    },
    { title: i18n.t("标记游标"), category: cat, when: "false" },
  );

  /* ── 05 案 C-4：query——发 ＋ 等应答，一次调用（02 工程「send → 睡 → read 有竞态」的正面解药）──
     内部：记游标 → sendText → 服务端阻塞等 expect（子串匹配）→ 回命中行与沿途收到的行。
     同口并发 ⇒ EBUSY（⛔ 不排队：两条指令的时序会错乱）。 */
  reg(
    "serial-monitor.query",
    async (args?: QueryArgs) => {
      const a = args ?? {};
      if (typeof a.send !== "string" || !a.send) return badArg("bad-send", `send 必须是非空字符串（收到 ${JSON.stringify(a.send)}）——要发什么指令`);
      if (typeof a.expect !== "string" || !a.expect) return badArg("bad-expect", `expect 必须是非空字符串（收到 ${JSON.stringify(a.expect)}）——等什么应答（子串匹配）`);
      if (a.timeoutMs === undefined || typeof a.timeoutMs !== "number" || !Number.isInteger(a.timeoutMs) || a.timeoutMs < 1 || a.timeoutMs > WAIT_TIMEOUT_MS_MAX) {
        return badArg("bad-timeout", `timeoutMs 必填（1–${WAIT_TIMEOUT_MS_MAX} 毫秒的整数，⛔ 不设无限等）——收到 ${JSON.stringify(a.timeoutMs)}；⚠️ 要小于 CLI/命令层超时，否则命令层先超时看不到 timedOut`);
      }
      const session = resolveSession(a.sessionId);
      if (!session && a.sessionId) throw sessionNotFoundError(a.sessionId);
      const portName = a.portName ?? session?.port ?? "";
      if (!portName) {
        return failCode("ENOPORT", "未指定端口，会话也没绑端口——给 portName 或先 openPort",
          "先 serial-monitor.listSessions 拿 sessionId");
      }
      if (_queryBusy.has(portName)) {
        return failCode("EBUSY", `端口 ${portName} 上已有一个 query 在等应答——并发会错乱时序`, "等当前 query 返回再发下一条");
      }
      const s = window.linkdesk?.serial;
      if (!s?.sendText) {
        return failCode("ESENDFAIL", "串口能力不可用（window.linkdesk.serial 缺失）");
      }
      _queryBusy.add(portName);
      const t0 = Date.now();
      try {
        const cursor0 = _receiveLog.seq;
        const enc = session?.sendCoding ?? "utf-8";
        try {
          await s.sendText(a.send, enc, portName);
        } catch (e) {
          return failCode("ESENDFAIL", `发送失败（${e instanceof Error ? e.message : String(e)}）——口开着吗？看 serial-monitor.receiveStatus`);
        }
        return await waitExpect({ port: portName, startSeq: cursor0, expect: a.expect, timeoutMs: a.timeoutMs });
      } finally {
        _queryBusy.delete(portName);
      }
    },
    { title: i18n.t("发送并等待应答"), category: cat, when: "false", async: true },
  );

  /* ── 05 案 E-1：reset——DTR/RTS 电气复位（只调既有 setDtr/setRts，零新 IPC）──
     序列：拉低 → 等 holdMs → 拉高；both = DTR 与 RTS 同相。
     ⚠️ 这是电气复位：板子没接复位电路时不生效（不是错误，是硬件事实——meta 里写明）。 */
  reg(
    "serial-monitor.reset",
    async (args?: ResetArgs) => {
      const a = args ?? {};
      if (a.method !== RESET_METHOD_DTR && a.method !== RESET_METHOD_RTS && a.method !== RESET_METHOD_BOTH) {
        return badArg("bad-method", `method 必须是 ${RESET_METHOD_DTR} | ${RESET_METHOD_RTS} | ${RESET_METHOD_BOTH}（收到 ${JSON.stringify(a.method)}）`);
      }
      const holdMs = a.holdMs ?? RESET_HOLD_MS_DEFAULT;
      if (typeof holdMs !== "number" || !Number.isInteger(holdMs) || holdMs < 1 || holdMs > RESET_HOLD_MS_MAX) {
        return badArg("bad-hold", `holdMs 必须是 1–${RESET_HOLD_MS_MAX} 的整数（收到 ${JSON.stringify(a.holdMs)}）——缺省 ${RESET_HOLD_MS_DEFAULT}`);
      }
      const session = resolveSession(a.sessionId);
      if (!session && a.sessionId) throw sessionNotFoundError(a.sessionId);
      const portName = a.portName ?? session?.port ?? "";
      if (!portName) {
        return failCode("ENOPORT", "未指定端口，会话也没绑端口——给 portName 或先 openPort",
          "先 serial-monitor.listSessions 拿 sessionId");
      }
      if (!hasOpenPort(portName)) {
        return failCode("ENOPORT", `端口 ${portName} 没开——DTR/RTS 电平只对已打开的口有效`, "先 serial-monitor.openPort");
      }
      const s = window.linkdesk?.serial;
      if (!s?.setDtr || !s?.setRts) {
        return failCode("EDEVICE", "宿主没有 setDtr/setRts 能力（软件太旧）——升级宿主后再用");
      }
      const t0 = Date.now();
      const low = a.method === RESET_METHOD_DTR ? s.setDtr(false, portName)
        : a.method === RESET_METHOD_RTS ? s.setRts(false, portName)
        : Promise.all([s.setDtr(false, portName), s.setRts(false, portName)]);
      await low;
      await sleep(holdMs);
      const high = a.method === RESET_METHOD_DTR ? s.setDtr(true, portName)
        : a.method === RESET_METHOD_RTS ? s.setRts(true, portName)
        : Promise.all([s.setDtr(true, portName), s.setRts(true, portName)]);
      await high;
      return { ok: true, portName, method: a.method, holdMs, tookMs: Date.now() - t0 };
    },
    { title: i18n.t("复位板子"), category: cat, when: "false" },
  );

  /* ── 可用串口清单（M2 AI#67 配套读）──
     「会话寻址」只解决「有哪几条会话」；外部 AI 在 0.2.25 复测里另一条够不着的是**硬件面**：
     门③ 只有 `exec`，「这台机器上插着哪几个口」在旧命令面上没有出口（`serial.listPorts` 是门② 的
     API，池内 JS 才够得着）⇒ AI 想指定 `portName` 只能瞎猜。本命令就是那个出口，且**与界面下拉
     同一条腿**（`refreshPortsFromModule`）：读数与 UI 不可能分叉。 */
  reg(
    "serial-monitor.listPorts",
    async () => {
      const sessions = getSessions();
      let raw: PortInfo[] | null = null;
      let why: string | null = null;
      try {
        raw = await refreshPortsFromModule();
      } catch (e) {
        why = e instanceof Error ? e.message : String(e);
      }
      // ⛔ 「问不出来」与「一个口都没有」必须分得开——两者的处置完全相反（前者查驱动/权限，后者插设备）
      if (raw === null) {
        return badArg("read-failed", `读串口清单失败（${why}）——这不等于一个口都没有，请查驱动/权限后重读`);
      }
      return {
        ok: true,
        count: raw.length,
        // `open` 取插件的 per-port 权威态（侧栏灯同一份）；`sessionId` 把口与会话对上——
        // 门前两步就齐了：先 listPorts 挑口，再拿 sessionId 走会话寻址改它。
        ports: raw.map((p) => ({
          portName: p.name,
          description: p.description || null,
          open: hasOpenPort(p.name),
          sessionId: sessions.find((s) => s.port === p.name)?.id ?? null,
        })),
      };
    },
    { title: i18n.t("列出可用串口"), category: cat, when: "false" },
  );

  /* ── 会话寻址·读（M2 AI#67）──
     外部 AI 在 0.2.25 复测里报「开关按不动」，实证是**会话不可寻址**：多串口下会话是多条并立的
     （本案：会话1 的「系统消息独立显示」是开的，会话2 是关的），而命令面只有「活跃会话」一个
     隐含目标 ⇒ 门外看不见有哪几条、更无法把会话与端口／标签页对上。本条就是那个缺口的一半。 */
  reg(
    "serial-monitor.listSessions",
    async () => {
      const sessions = getSessions();
      // 05 案 A-3：设备在场——stale = 「表里说开着，实际设备没了」（拔插 USB 后 open:true 撒谎的解药）
      const present = await presentPortNames();
      return {
        ok: true,
        count: sessions.length,
        activeSessionId: getActiveSessionId(),
        sessions: sessions.map((s) => {
          // 视图态读数的唯一来源：`_cmdMap`（每挂载一个串口视图写一格，键 = 会话 id）。
          // ⛔ 没挂载就报 null，⛔ 不报 false 假装问过——「标签页没开」与「暂停态是假的」不是一回事。
          const cmd = _cmdMap.get(s.id);
          const open = hasOpenPort(s.port);
          const devicePresent = s.port && present ? present.has(s.port) : (present === null ? null : false);
          return {
            sessionId: s.id,
            name: s.name,
            portName: s.port || null,
            open,
            // 05 案 A-3：devicePresent 读不到（无硬件面）⇒ null 不猜；stale 只在「open 且确认不在」时为 true
            devicePresent,
            stale: open === true && devicePresent === false,
            viewMounted: Boolean(cmd),
            paused: cmd ? cmd.paused : null,
            baudRate: Number(s.baudRate || 115200),
            sendMode: s.sendMode,
            sendCoding: s.sendCoding,
            receiveCoding: s.receiveCoding,
            showEcho: s.showEcho,
            showLineNumbers: s.showLineNumbers,
            separateSystemLog: s.separateSystemLog,
            autoRepeat: s.autoRepeat,
            autoClear: s.autoClear,
          };
        }),
      };
    },
    { title: i18n.t("列出串口会话"), category: cat, when: "false" },
  );

  /* ── 会话寻址·写：六条会话态开关（M2 AI#67）──
     handler 住本文件（常驻，⛔ 不再随视图走）——会话表是模块级单例，比标签页活得久：AI 点名要改的
     那条会话可能根本没开标签页。
     回执带 `field` / `previous` / `value`（改后回读）——⛔ 别让调用方从命令面板标题反推状态。
     `AI#68`：标题从此**与状态无关**（固定动作名），也不再按活跃会话取一次当前值——理由见
     `SESSION_TOGGLES` 上方的头注（一个标题槽 × 多条会话 = 按构造会撒谎）。 */
  for (const spec of SESSION_TOGGLES) {
    reg(spec.id, SESSION_TOGGLE_HANDLERS[spec.id], {
      title: i18n.t(spec.title),
      category: cat,
      when: whenActive,
    });
  }

  // 20 = 八条动作/读数（T9 起 quickSendEdit 归视图，不在入口）＋ 两条寻址读（listPorts/listSessions）
  //    ＋ 六条会话态开关 ＋ 05 案四条（reopen A-4 / mark C-1 / query C-4 / reset E-1）
  return 8 + 2 + 4 + SESSION_TOGGLES.length;
}
