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
import { deleteOpenPort, getOpenPorts, _notifyPort, _writePortState } from "./SerialContext/store";
import {
  closePortFromModule, openPortFromModule, refreshPortsFromModule,
} from "./SerialContext/ipc";
import type { PortInfo } from "./SerialContext/types";
// AI#64：接收面读数（游标式拉取）——日志属主在 receiveLog，本文件只做参数归一 ＋ 回执成形
// 05 案起读数走 queryReceiveLog（since/tail/过滤一躺循环）；readReceiveLog 留给旧测试与兼容
import { _receiveLog, queryReceiveLog, receiveLogFirst } from "./receiveLog";
import type { ReceiveLogItem } from "./receiveLog";
import { SERIAL_ERROR_CODES, serialError } from "./serialErrors";
import type { SerialCommandError } from "./serialErrors";
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
function sessionNotFoundError(sessionId: string): SerialCommandError {
  return serialError(
    SERIAL_ERROR_CODES.EBADARGS,
    `找不到会话 "${sessionId}"——现有：${describeSessions()}（会话清单看 serial-monitor.listSessions）`,
    "先 serial-monitor.listSessions 取有效 sessionId（不传 sessionId = 当前活跃会话）",
    { sessionId },
  );
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
   成功 `{ok:true,…}`；noop `{ok:true,noop:true,reason}`（沿用 badArg 三件套）；
   **预期失败 = `return serialError(...)`**（`{isPluginError:true,code,message,hint?,details?}`，
   跨 contextBridge 可携带；⛔ throw —— 异常跨桥只留 message，码会被壳归成 EUNKNOWN）。
   `reason`（noop，"我没动，因为没必要"）与 `code`（失败，"我做不到"）分工不同——⛔ 别混用。 */

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

/** 壳报告的打开口集合（`serial.getStatus()` = 主进程句柄账）——读不到退回本地集合（⛔ 不猜成空）。 */
async function shellOpenPortNames(): Promise<Set<string>> {
  try {
    const statuses = await window.linkdesk?.serial?.getStatus?.();
    if (!Array.isArray(statuses)) return new Set(getOpenPorts());
    return new Set(
      statuses
        .filter((s) => s && s.isOpen !== false && typeof s.portName === "string" && s.portName)
        .map((s) => s.portName!),
    );
  } catch { return new Set(getOpenPorts()); }
}

/**
 * 🔴 开态的**唯一权威收口**：壳句柄账 ∩ 设备在场。
 *
 * 判据（2026-11-25 拔插实测）：`open:true` 必须能被 OS 事实验证——
 *   · 壳说开（getStatus）但设备已从串口清单消失 ⇒ **不算开**（死句柄），且把本地权威态摘掉
 *     （灭灯＋通知），⛔ 不让 `listSessions/receiveStatus/listPorts` 继承旧缓存继续撒谎；
 *   · 硬件面读不到（null）⇒ 只信壳账（⛔ 不拿猜测当否定）。
 * 所有读面（listSessions/listPorts/receiveStatus/buildPortState）与写面（openPort/closePort/reopen）
 * 都走这一条，⛔ 各拼一份 `hasOpenPort`。
 */
async function authoritativeOpenState(): Promise<{
  open: Set<string>;
  present: Set<string> | null;
  /** 壳报告的原始句柄账（未按设备在场过滤）——僵尸清理要按这个判断「壳是否还攥着」 */
  shellOpen: Set<string>;
}> {
  const shellOpen = await shellOpenPortNames();
  const present = await presentPortNames();
  const open = new Set([...shellOpen].filter((p) => present === null || present.has(p)));
  // 本地缓存向权威态对齐：不再是「开」的口摘账（灯灭＋per-port 通知）——僵尸句柄不留在插件账上
  for (const p of getOpenPorts()) {
    if (!open.has(p)) {
      deleteOpenPort(p);
      _writePortState(p, false);
      _notifyPort(p);
    }
  }
  return { open, present, shellOpen };
}

/** 口 → 属主会话（**唯一**：多会话同绑一口时只认第一条，其余「未持有此口」）。 */
function portOwnerSessionId(portName: string | null): string | null {
  if (!portName) return null;
  return getSessions().find((s) => s.port === portName)?.id ?? null;
}

/**
 * 某口属主会话的**视图暂停态**——没挂视图 ⇒ `false`（A 第二轮实测：`paused` 必须是布尔，
 * ⛔ 从 false 漂成 null）。语义：暂停只冻结显示；没有视图 = 没有显示可冻结 ⇒ false。
 * 多会话同绑一口时只读属主会话那一格（与 `portOwnerSessionId` 同一口径）。
 */
function pausedForPort(portName: string | null): boolean {
  if (!portName) return false;
  const ownerId = portOwnerSessionId(portName);
  const cmd = ownerId ? _cmdMap.get(ownerId) : undefined;
  return cmd ? cmd.paused : false;
}

/** 05 案 A-1：读取面随行的 state 块。portName 定不下来（没给且推不出唯一口）⇒ `null`，⛔ 不猜。 */
export interface PortReadState {
  paused: boolean;
  portOpen: boolean;
  devicePresent: boolean | null;
}
async function buildPortState(portName: string | null): Promise<PortReadState | null> {
  if (!portName) return null;
  const { open, present } = await authoritativeOpenState();
  return {
    paused: pausedForPort(portName),
    portOpen: open.has(portName),
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
        return serialError(SERIAL_ERROR_CODES.EDEVICE, `等待期间设备消失（${o.portName} 已不在串口清单里）`, "设备可能被拔掉；插回后 serial-monitor.reopen", { portName: o.portName });
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
        return serialError(SERIAL_ERROR_CODES.EDEVICE, `等待应答期间设备消失（${o.port}）`, "设备可能被拔掉；插回后 serial-monitor.reopen", { portName: o.port });
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
      // 07（A 契约补齐）：入参先归一判——坏参给 EBADARGS，⛔ 让底层异常以壳兜底 ESHELLERROR 露面
      if (a.portName !== undefined && (typeof a.portName !== "string" || !a.portName.trim())) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `portName 必须是非空字符串（收到 ${JSON.stringify(a.portName)}）`,
          "先 serial-monitor.listPorts 拿可用端口名",
          { portName: a.portName },
        );
      }
      if (a.baudRate !== undefined && (!Number.isInteger(a.baudRate) || a.baudRate < 1)) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `baudRate 必须是正整数（收到 ${JSON.stringify(a.baudRate)}）`,
          "常见值：9600 / 115200",
          { baudRate: a.baudRate },
        );
      }
      if (a.dataBits !== undefined && ![5, 6, 7, 8].includes(a.dataBits)) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `dataBits 必须是 5 | 6 | 7 | 8（收到 ${JSON.stringify(a.dataBits)}）`,
          "缺省 8（8N1）",
          { dataBits: a.dataBits },
        );
      }
      if (a.stopBits !== undefined && a.stopBits !== 1 && a.stopBits !== 2) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `stopBits 必须是 1 | 2（收到 ${JSON.stringify(a.stopBits)}）`,
          "缺省 1",
          { stopBits: a.stopBits },
        );
      }
      if (a.parity !== undefined && !["none", "odd", "even", "mark", "space"].includes(a.parity)) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `parity 必须是 none | odd | even | mark | space（收到 ${JSON.stringify(a.parity)}）`,
          "缺省 none",
          { parity: a.parity },
        );
      }
      // 🔴 `AI#68`：**多会话下不打名，靶子就是「谁在前台」**——下面的 `patch.port = a.portName` 会改绑
      //    那条会话的口，而活跃会话随用户切标签页变（真机复现：同一条 `openPort {"portName":"COM4"}`
      //    落到哪条会话，取决于调用瞬间前台是谁——用户切一下标签页，结果就变了）。
      //    这类「行为取决于调用瞬间」的写对无人值守的 AI 不可推理 ⇒ **拒**，并把「现有哪几条、各自
      //    绑谁、谁是活跃」一次说全（⛔ 不猜、⛔ 不默认打活跃会话）。
      //    ⚠️ 不带 portName 的调用不受影响：那时靶子就是「当前这条」，与手点侧栏「打开」同义（没有改绑）。
      if (a.portName && !a.sessionId && getSessions().length > 1) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `多会话下给 portName 必须点名 sessionId（现有：${describeSessions()}）`
          + "——只给 portName 会改绑「当前活跃会话」的口，而活跃会话随前台标签页变（同一条命令两种结果）；"
          + "各会话当前绑的口与 id 看 serial-monitor.listSessions",
          "同时给 sessionId；只开当前会话的口就别传 portName",
          { portName: a.portName, sessionCount: getSessions().length },
        );
      }
      let session = resolveSession(a.sessionId);
      // 🔴 AI#67：**显式点名了会话却没命中 ⇒ 如实报错**（⛔ 别顺手新建一条——那会把「我要开会话2」
      // 变成「多出一条会话」，正是本系列反复消灭的「账面无错、其实做错了别的」）。
      if (!session && a.sessionId) return sessionNotFoundError(a.sessionId);
      const previousPortName = session?.port || null; // `AI#68`：改绑前那个口——回执要说清「这一笔动没动绑定」
      // 目标口：显式 portName → 会话已绑 → 第一个可用口。**此时还不建会话、不写绑定**——
      // ❷（2026-11-25 实测）：失败路径必须零副作用，失败后保留**原**绑定（reopen 锚点）。
      let portName = a.portName ?? session?.port ?? "";
      if (!portName) {
        const ports = await refreshPortsFromModule();
        if (ports.length === 0) {
          return serialError(
            SERIAL_ERROR_CODES.ENOPORT,
            "没有可用串口——请先插上设备，或用 portName 指定端口",
            "先 serial-monitor.listPorts 核对当前端口；无设备时插上再试",
            { portName: a.portName ?? null },
          );
        }
        portName = ports[0].name;
      }
      // 期望设置——只用于本次打开；**成功后才提交到会话**（失败零副作用）
      const desired: Partial<SerialSession> = {};
      if (a.baudRate !== undefined) desired.baudRate = String(a.baudRate);
      if (a.dataBits !== undefined) desired.dataBits = Number(a.dataBits);
      if (a.stopBits !== undefined) desired.stopBits = Number(a.stopBits);
      if (a.parity) desired.parity = a.parity;
      if (a.encoding) desired.receiveCoding = a.encoding;
      const effective = {
        ...(session ?? {}),
        port: portName,
        baudRate: desired.baudRate ?? session?.baudRate ?? "115200",
        dataBits: desired.dataBits ?? session?.dataBits ?? 8,
        stopBits: desired.stopBits ?? session?.stopBits ?? 1,
        parity: desired.parity ?? session?.parity ?? "none",
        receiveCoding: desired.receiveCoding ?? session?.receiveCoding ?? "utf-8",
      } as SerialSession;
      const opts = sessionPortOptions(effective);

      const { open, present, shellOpen } = await authoritativeOpenState();
      if (open.has(portName)) {
        // 真开着（壳句柄在且设备在场）：本命令是「打开」不是「翻转」，如实回读不假装刚开。
        // ❹：`opened` 只由权威态决定——⛔ 拿本地旧缓存判「已开」。
        return {
          opened: false, alreadyOpen: true, sessionId: session?.id ?? null, portName, previousPortName,
          baudRate: opts.baudRate,
        };
      }
      if (shellOpen.has(portName) && present !== null && !present.has(portName)) {
        // ❶：壳账开着但设备已不在 ⇒ 僵尸句柄——先走一次 close 摘账，再如实 EDEVICE（不尝试开死口）
        await closePortFromModule(portName);
        return serialError(
          SERIAL_ERROR_CODES.EDEVICE,
          `设备不在（${portName} 不在串口清单里）——打不开`,
          "插回后 serial-monitor.openPort 或 serial-monitor.reopen；端口号可能变，先 serial-monitor.listPorts 核对",
          { portName },
        );
      }
      let opened: boolean;
      try {
        opened = await openPortFromModule({ portName, ...opts });
      } catch (e) {
        // 已是结构化错误（例如上游 serialError）⇒ 原样上抛；壳/驱动的裸错误 ⇒ 归一成 EDEVICE
        if ((e as { isPluginError?: unknown })?.isPluginError) return e as SerialCommandError;
        const cause = e instanceof Error ? e.message : String(e);
        return serialError(
          SERIAL_ERROR_CODES.EDEVICE,
          `打不开串口 ${portName}：${cause.replace(/^串口打开失败[：:]\s*/, "")}`,
          "确认设备已插好、未被其他程序占用、当前用户有串口权限；端口号可能变了，先 serial-monitor.listPorts 核对",
          { portName },
        );
      }
      if (!opened) {
        return serialError(
          SERIAL_ERROR_CODES.EDEVICE,
          `串口 ${portName} 没有打开（宿主串口能力不可用）`,
          "升级宿主到支持串口的版本后再试",
          { portName },
        );
      }
      // ✅ 成功才提交：没有会话才建（失败时不留空会话）＋绑定/设置一次写入
      if (!session) session = createSessionModule(i18n.t("会话"));
      if (previousPortName !== portName || Object.keys(desired).length > 0) {
        updateSessionById(session.id, { port: portName, ...desired });
      }
      return {
        opened: true, sessionId: session.id, portName, previousPortName, baudRate: opts.baudRate,
        encoding: opts.encoding ?? null, frame: opts.frame,
      };
    },
    { title: i18n.t("打开端口"), category: cat, when: whenActive },
  );

  /* ── 关闭端口 ── */
  reg(
    "serial-monitor.closePort",
    async (args?: PortTargetArgs) => {
      const requestedId = args?.sessionId;
      const session = resolveSession(requestedId);
      // 🔴 AI#67：点名了会话却没命中 ⇒ 如实报「找不到会话」——⛔ 别退化成「未指定端口」那种答非所问
      if (!session && requestedId) return sessionNotFoundError(requestedId);
      const portName = args?.portName ?? session?.port ?? "";
      if (!portName) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          "未指定端口——会话也没绑端口（给 portName 或先选口）",
          "先 serial-monitor.listPorts 挑口，或用 serial-monitor.listSessions 看会话绑了哪个口",
        );
      }
      // 🔴 ❸（2026-11-25 实测）：**按 requestedSessionId 作用**——点名会话就只认它是否为属主；
      //    ⛔ 拿「这个口的第一个绑定者」顶替（旧面会作用到 session-1，还在回执里报 requestedSessionId）。
      //    端口归属唯一（❺）：多会话同绑一口时只有 portOwnerSessionId 那条持有它。
      const ownerId = portOwnerSessionId(portName);
      if (requestedId && ownerId !== requestedId) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `会话 ${requestedId} 没有持有 ${portName}（属主：${ownerId ?? "无"}）——未执行关闭`,
          "按 serial-monitor.listSessions 的 portOwnerSessionId 点名属主会话；⛔ 不会替你关别人的口",
          { requestedSessionId: requestedId, portName, portOwnerSessionId: ownerId },
        );
      }
      // ❸：关的是**句柄**——按壳账判（设备是否在场不影响「释放句柄」这件事）
      const { shellOpen } = await authoritativeOpenState();
      if (!shellOpen.has(portName)) {
        // 语义唯一：没关就是 closed:false + reason（⛔ 不再同时给 alreadyClosed:true 那种自相矛盾的两面）
        return { closed: false, reason: "already-closed", portName, sessionId: ownerId };
      }
      await closePortFromModule(portName);
      return { closed: true, portName, sessionId: ownerId };
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
        if (args?.sessionId) return sessionNotFoundError(args.sessionId);
        const names = getSessions().map((s) => s.name).join("、") || "（无）";
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `找不到会话（name 没命中；现有：${names}；会话清单看 serial-monitor.listSessions）`,
          "用 serial-monitor.listSessions 核对会话 name / id",
          { name: args?.name ?? null },
        );
      }
      const { shellOpen } = await authoritativeOpenState();
      const isOpen = session.port ? shellOpen.has(session.port) : false;
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
      if (!coding) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `缺少 coding——可选：${SERIAL_CODINGS.join(" / ")}`,
          "coding 必填；常用 utf-8 / GBK / Shift-JIS",
        );
      }
      if (!(SERIAL_CODINGS as readonly string[]).includes(coding)) {
        // 取值限于下拉那一套——否则会造出「命令设得进、下拉选不出」的新不一致
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `不支持的编码 "${coding}"——可选：${SERIAL_CODINGS.join(" / ")}`,
          "取值必须在下拉那一套里",
          { coding },
        );
      }
      const session = resolveSession(args?.sessionId);
      if (!session && args?.sessionId) return sessionNotFoundError(args.sessionId);
      if (!session) {
        return serialError(
          SERIAL_ERROR_CODES.ENOPORT,
          "没有会话可设——先用 openPort 建会话，或给 sessionId",
          "先 serial-monitor.openPort，或 serial-monitor.listSessions 取 sessionId",
        );
      }
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
      if (!s) {
        return serialError(
          SERIAL_ERROR_CODES.ESENDFAIL,
          "串口能力不可用（window.linkdesk.serial 缺失）",
          "升级宿主到支持串口的版本后再试",
        );
      }
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
      if (!key) {
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          "缺少 quickSendName——要删哪一颗快捷发送",
          "先不带参数看不出清单；用界面的快捷发送栏或 serial-monitor.listSessions 核对",
        );
      }
      const session = resolveSession(ctx?.sessionId);
      if (!session && ctx?.sessionId) return sessionNotFoundError(ctx.sessionId);
      if (!session) {
        return serialError(
          SERIAL_ERROR_CODES.ENOPORT,
          "没有会话可删快捷发送",
          "先 serial-monitor.openPort 建会话",
        );
      }
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
        return serialError(
          SERIAL_ERROR_CODES.EBADARGS,
          `since / tail / afterMark 三种取法互斥（tail 也不可与 untilRegex 同给）——一次只给一个（收到 ${JSON.stringify({ since: a.since, tail: a.tail, afterMark: a.afterMark })}）`,
          "一次只给一种取法；要历史用 since:0，要最近 N 条用 tail，要游标用 afterMark",
          { reason: "mode-conflict", since: a.since, tail: a.tail, afterMark: a.afterMark },
        );
      }
      // 05 案 C-2：命名游标先解析（它是 since 的来源之一）
      let markSeq: number | undefined;
      if (a.afterMark !== undefined) {
        if (typeof a.afterMark !== "string" || !a.afterMark.trim()) {
          return badArg("bad-aftermark", `afterMark 必须是非空字符串（收到 ${JSON.stringify(a.afterMark)}）——先 serial-monitor.mark {"name":"…"}`);
        }
        const mark = _marks.get(a.afterMark.trim());
        if (!mark) {
          return serialError(SERIAL_ERROR_CODES.ENOMARK,
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
      // ❶：开态 = 壳句柄账 ∩ 设备在场（唯一收口）——⛔ 再单独信 getStatus 或本地缓存
      const { open, present } = await authoritativeOpenState();
      const openPorts = [...open];
      const now = Date.now();
      const counts = new Map<string, number>();
      for (const item of _receiveLog.items) counts.set(item.portName, (counts.get(item.portName) ?? 0) + 1);
      const ports = new Map<string, {
        portName: string; count: number; open: boolean;
        devicePresent: boolean | null; lastDataAt: number | null; idleMs: number | null;
        state: { paused: boolean; portOpen: boolean; devicePresent: boolean | null };
      }>();
      const entryFor = (portName: string, count: number, open: boolean) => {
        const lastDataAt = _receiveLog.lastDataAt.get(portName) ?? null;
        const devicePresent = present ? present.has(portName) : null;
        return {
          portName, count, open, devicePresent, lastDataAt,
          idleMs: lastDataAt !== null ? now - lastDataAt : null,
          // ❻：paused 恒为布尔——没挂视图 = 没有显示可冻结 ⇒ false（⛔ 从 false 漂成 null）
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
      if (!session && a.sessionId) return sessionNotFoundError(a.sessionId);
      const portName = a.portName ?? session?.port ?? "";
      if (!portName) {
        return serialError(SERIAL_ERROR_CODES.ENOPORT, "未指定端口，会话也没绑端口——给 portName 或先 openPort",
          "先 serial-monitor.listPorts 挑口，再 serial-monitor.listSessions 拿 sessionId");
      }
      // 「同一会话同参数」——参数（波特率/帧格式/编码）从属主会话读起；点名 portName 而无会话绑它 ⇒ 没有可恢复的参数
      const owner = session ?? getSessions().find((s) => s.port === portName) ?? null;
      if (!owner) {
        return serialError(SERIAL_ERROR_CODES.ENOSESSION, `端口 ${portName} 没有绑在任何会话上——reopen 按「同一会话同参数」恢复，参数无从读起`,
          "先 serial-monitor.openPort 建会话（它会把参数存进会话）");
      }
      // ❶：开态取权威态（壳句柄账 ∩ 设备在场）用于**可恢复性**判断；「句柄在不在」看 shellOpen
      const { shellOpen, present } = await authoritativeOpenState();
      const wasOpen = shellOpen.has(portName);
      // 设备不在就别白折腾——如实 EDEVICE（02 A-4）
      if (present !== null && !present.has(portName)) {
        return serialError(SERIAL_ERROR_CODES.EDEVICE, `设备不在（${portName} 不在串口清单里）——插回后再 reopen`,
          "端口号可能变，先 serial-monitor.listPorts 核对 COM 号");
      }
      const t0 = Date.now();
      if (wasOpen) await closePortFromModule(portName);
      await sleep(REOPEN_GAP_MS);
      let okOpen: boolean;
      try {
        okOpen = await openPortFromModule({ portName, ...sessionPortOptions(owner) });
      } catch (e) {
        if ((e as { isPluginError?: unknown })?.isPluginError) return e as SerialCommandError;
        const cause = e instanceof Error ? e.message : String(e);
        return serialError(
          SERIAL_ERROR_CODES.EDEVICE,
          `重开 ${portName} 失败：${cause.replace(/^串口打开失败[：:]\s*/, "")}`,
          "确认设备已插回、未被其他程序占用；先 serial-monitor.listPorts 核对端口号",
          { portName, sessionId: owner.id },
        );
      }
      if (!okOpen) {
        return serialError(
          SERIAL_ERROR_CODES.EDEVICE,
          `重开 ${portName} 失败——串口能力不可用或打开被拒（可能被其他程序占用）`,
          "确认设备已插回、未被其他程序占用；先 serial-monitor.listPorts 核对端口号",
          { portName, sessionId: owner.id },
        );
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
      if (!session && a.sessionId) return sessionNotFoundError(a.sessionId);
      const portName = a.portName ?? session?.port ?? "";
      if (!portName) {
        return serialError(SERIAL_ERROR_CODES.ENOPORT, "未指定端口，会话也没绑端口——给 portName 或先 openPort",
          "先 serial-monitor.listSessions 拿 sessionId");
      }
      if (_queryBusy.has(portName)) {
        return serialError(SERIAL_ERROR_CODES.EBUSY, `端口 ${portName} 上已有一个 query 在等应答——并发会错乱时序`, "等当前 query 返回再发下一条");
      }
      const s = window.linkdesk?.serial;
      if (!s?.sendText) {
        return serialError(SERIAL_ERROR_CODES.ESENDFAIL, "串口能力不可用（window.linkdesk.serial 缺失）");
      }
      _queryBusy.add(portName);
      const t0 = Date.now();
      try {
        const cursor0 = _receiveLog.seq;
        const enc = session?.sendCoding ?? "utf-8";
        try {
          await s.sendText(a.send, enc, portName);
        } catch (e) {
          return serialError(SERIAL_ERROR_CODES.ESENDFAIL, `发送失败（${e instanceof Error ? e.message : String(e)}）——口开着吗？看 serial-monitor.receiveStatus`);
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
      if (!session && a.sessionId) return sessionNotFoundError(a.sessionId);
      const portName = a.portName ?? session?.port ?? "";
      if (!portName) {
        return serialError(SERIAL_ERROR_CODES.ENOPORT, "未指定端口，会话也没绑端口——给 portName 或先 openPort",
          "先 serial-monitor.listSessions 拿 sessionId");
      }
      const { shellOpen } = await authoritativeOpenState();
      if (!shellOpen.has(portName)) {
        return serialError(SERIAL_ERROR_CODES.ENOPORT, `端口 ${portName} 没开——DTR/RTS 电平只对已打开的口有效`, "先 serial-monitor.openPort");
      }
      const s = window.linkdesk?.serial;
      if (!s?.setDtr || !s?.setRts) {
        return serialError(SERIAL_ERROR_CODES.EDEVICE, "宿主没有 setDtr/setRts 能力（软件太旧）——升级宿主后再用");
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
      // ❶❺：open 只认「壳句柄账 ∩ 本次硬件面」，且属主会话唯一
      const { open: openNow } = await authoritativeOpenState();
      return {
        ok: true,
        count: raw.length,
        // `open` 取权威态（壳句柄账 ∩ 设备在场）；`sessionId` 把口与**属主**会话对上——
        // 门前两步就齐了：先 listPorts 挑口，再拿 sessionId 走会话寻址改它。
        ports: raw.map((p) => ({
          portName: p.name,
          description: p.description || null,
          open: openNow.has(p.name),
          sessionId: portOwnerSessionId(p.name),
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
      // 05 案 A-3 / ❶❺：开态 = 壳句柄账 ∩ 设备在场；端口归属唯一（owner 之外「未持有此口」）
      const { open: openNow, present } = await authoritativeOpenState();
      return {
        ok: true,
        count: sessions.length,
        activeSessionId: getActiveSessionId(),
        sessions: sessions.map((s) => {
          // 视图态读数的唯一来源：`_cmdMap`（每挂载一个串口视图写一格，键 = 会话 id）。
          const cmd = _cmdMap.get(s.id);
          const ownerId = portOwnerSessionId(s.port);
          const open = ownerId === s.id && openNow.has(s.port);
          const devicePresent = s.port && present ? present.has(s.port) : (present === null ? null : false);
          return {
            sessionId: s.id,
            name: s.name,
            portName: s.port || null,
            portOwnerSessionId: ownerId,
            open,
            // ❶：stale = 「绑着某口，但该口已不在硬件清单」——open 已按权威态收紧（设备不在 ⇒ false），
            // 故 stale 不能再以 open 为前提；它报的是**绑定**过期，不是句柄还开着。
            devicePresent,
            stale: Boolean(s.port) && devicePresent === false,
            viewMounted: Boolean(cmd),
            paused: cmd ? cmd.paused : false,
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
