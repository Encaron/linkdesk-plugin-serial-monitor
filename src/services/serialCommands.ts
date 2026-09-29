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
import { SERIAL_CODINGS, SEND_MODE_HEX, SEND_MODE_TEXT, RECEIVE_LOG_MAX, RECEIVE_READ_LIMIT_DEFAULT, RECEIVE_READ_LIMIT_MAX } from "../constants";
import { getOpenPorts, hasOpenPort } from "./SerialContext/store";
import {
  closePortFromModule, openPortFromModule, refreshPortsFromModule,
} from "./SerialContext/ipc";
import type { PortInfo } from "./SerialContext/types";
// AI#64：接收面读数（游标式拉取）——日志属主在 receiveLog，本文件只做参数归一 ＋ 回执成形
import { _receiveLog, readReceiveLog, receiveLogFirst } from "./receiveLog";
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
  /** 游标——上一次回执里的 `cursor`；缺省 0 = 从缓冲里最老一条读起 */
  since?: number;
  /** 本次最多取几条（1–1000，缺省 200） */
  limit?: number;
  /** 只看这个口（缺省 = 所有口）——⚠️ 游标按全局面上的位置前进，不受过滤影响 */
  portName?: string;
}

/**
 * 归一 `readSince` 入参——两形等价：逐位 `(since, limit, portName)` 与单具名对象 `{since,limit,portName}`。
 *
 * 照 `AI#52` 窄口：壳在**声明了 ≥2 个 params** 时按声明序展开具名对象，但「只传一个键」这类形状
 * 仍可能整包落进 `args[0]` ⇒ 这里自己认一次，两形行为一致（照壳侧 `readCommands.pickStringArg` 同款）。
 */
function normalizeReadArgs(since?: unknown, limit?: unknown, portName?: unknown): ReadSinceArgs {
  if (since !== null && typeof since === "object" && !Array.isArray(since)) {
    const o = since as Record<string, unknown>;
    return { since: o.since as number, limit: o.limit as number, portName: o.portName as string | undefined };
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

/** 现有会话的可读清单——报「找不到」时要能顺便告诉对方**有哪些**（⛔ 别让调用方再来问一次） */
function describeSessions(): string {
  const all = getSessions();
  return all.length === 0 ? "（一条都没有）" : all.map((s) => `${s.name}[${s.id}]`).join("、");
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

/* ── M2 `AI#67`：会话态开关的**定义表**（handler 只写一遍） ──
 *
 * 🔴 为什么集中成表：原先七条开关的 handler 手写在 `views/SerialMonitorView/useToggleCommands.ts`
 *    里（连标题刷新一起，七块 × 2 处）。会话寻址进来后 handler 必须与「视图在不在场」解耦——
 *    外面 AI 要点名改的那条会话**可能根本没开标签页**（会话表是模块级单例，比标签页活得久）
 *    ⇒ handler 搬到插件级（本文件常驻注册），视图只留「按当前态换标题」。
 *
 * ⚠️ 标题文案仍是**两条**（开/关各一，key = 原文）——`titleKey(current)` 按当前值二选一，
 *    插件级注册（`i18n.t`）与视图态重注册（`t`）**共用这一个函数**，⛔ 别在视图里再抄一份措辞。
 */
export type SessionToggleField = "sendMode" | "showEcho" | "showLineNumbers" | "separateSystemLog" | "autoRepeat" | "autoClear";

export interface SessionToggleSpec {
  /** 命令 id */
  id: string;
  /** 被翻转的会话字段——回执里用 `field` 回显它（⛔ 不用动态键：调用方要能稳定读到字段名） */
  field: SessionToggleField;
  /** 命令面板标题的 i18n key（按当前值二选一） */
  titleKey: (current: unknown) => string;
  /** 由「当前值」算「新值」 */
  next: (current: unknown) => unknown;
}

const flipBool = (v: unknown) => v !== true;
const altSendMode = (v: unknown) => (v === SEND_MODE_HEX ? SEND_MODE_TEXT : SEND_MODE_HEX);

export const SESSION_TOGGLES: readonly SessionToggleSpec[] = [
  {
    id: "serial-monitor.toggleSendMode",
    field: "sendMode",
    titleKey: (v) => (v === SEND_MODE_HEX ? "切换到文本发送" : "切换到 HEX 发送"),
    next: altSendMode,
  },
  {
    id: "serial-monitor.toggleEcho",
    field: "showEcho",
    titleKey: (v) => (v === true ? "关闭消息回显" : "开启消息回显"),
    next: flipBool,
  },
  {
    id: "serial-monitor.toggleLineNumbers",
    field: "showLineNumbers",
    titleKey: (v) => (v === true ? "隐藏行号" : "显示行号"),
    next: flipBool,
  },
  {
    id: "serial-monitor.toggleSystemLog",
    field: "separateSystemLog",
    titleKey: (v) => (v === true ? "关闭系统消息独立显示" : "开启系统消息独立显示"),
    next: flipBool,
  },
  {
    id: "serial-monitor.toggleAutoRepeat",
    field: "autoRepeat",
    titleKey: (v) => (v === true ? "关闭自动重发" : "开启自动重发"),
    next: flipBool,
  },
  {
    id: "serial-monitor.toggleAutoClear",
    field: "autoClear",
    titleKey: (v) => (v === true ? "关闭自动清屏" : "开启自动清屏"),
    next: flipBool,
  },
];

/** 取某条开关的标题 key（按当前值）——插件级注册与视图态重注册共用 */
export function sessionToggleTitleKey(id: string, current: unknown): string {
  const spec = SESSION_TOGGLES.find((s) => s.id === id);
  return spec ? spec.titleKey(current) : id;
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
      let session = resolveSession(a.sessionId);
      // 🔴 AI#67：**显式点名了会话却没命中 ⇒ 如实报错**（⛔ 别顺手新建一条——那会把「我要开会话2」
      // 变成「多出一条会话」，正是本系列反复消灭的「账面无错、其实做错了别的」）。
      if (!session && a.sessionId) throw sessionNotFoundError(a.sessionId);
      // 一个会话都没有 → 建一个（同 useSession 的自动建会话语义——否则「打开端口」在空插件上无处落）
      if (!session) session = createSessionModule(i18n.t("会话"));
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
        // 已开：不动（本命令是「打开」不是「翻转」——关有 closePort）——如实回读，不假装刚开
        return { opened: false, alreadyOpen: true, sessionId: next.id, portName, baudRate: opts.baudRate };
      }
      await openPortFromModule({ portName, ...opts });
      return {
        opened: true, sessionId: next.id, portName, baudRate: opts.baudRate,
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
      if (!hasOpenPort(portName)) {
        return { closed: false, alreadyClosed: true, portName, sessionId: session?.id ?? null };
      }
      await closePortFromModule(portName);
      return { closed: true, portName, sessionId: session?.id ?? null };
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
      if (!SERIAL_CODINGS.includes(coding)) {
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

  /* ── 快捷发送：编辑（编辑态住视图 ⇒ 无视图时给可读报错，而不是 null 解引用）── */
  reg(
    "serial-monitor.quickSendEdit",
    async (...args) => {
      const ctx = args[0] as { quickSendName?: string } | undefined;
      if (!ctx?.quickSendName) throw new Error("缺少 quickSendName——要编辑哪一颗快捷发送");
      throw new Error(
        `编辑快捷发送「${ctx.quickSendName}」需要打开该会话的串口标签页（编辑框是视图态，无视图无处显示）`
        + "——先开标签页，或在会话里直接改快捷发送内容",
      );
    },
    { title: i18n.t("编辑"), category: cat, when: whenActive },
  );

  /* ── 接收面读数·拉取（M2 AI#64——门③ 读得到串口回声）──
     回执三态（与壳 AI#55/AI#60、插件侧 AI#56 同口径，⛔ 不是「ok 就是干成了」）：
       有新数据 `{ok:true, items, cursor, count, lost}` ／ 没有新的 `{ok:true, noop:true, reason:"no-new-data"}`
       ／ 调用本身不成立 `{ok:false, noop:true, reason:"bad-since"|"bad-limit"|"bad-port"|"cursor-ahead"|"no-serial-face"}`
     `lost` = 已滚出缓冲、你再也读不到的条数（> 0 才说明落后了）——⛔ 别把它做成静默。 */
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
      const since = a.since ?? 0;
      if (typeof since !== "number" || !Number.isInteger(since) || since < 0) {
        return badArg("bad-since", `since 必须是非负整数（收到 ${JSON.stringify(a.since)}）——缺省 0 = 从缓冲里最老一条读起`);
      }
      const limit = a.limit ?? RECEIVE_READ_LIMIT_DEFAULT;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > RECEIVE_READ_LIMIT_MAX) {
        return badArg("bad-limit", `limit 必须是 1–${RECEIVE_READ_LIMIT_MAX} 的整数（收到 ${JSON.stringify(a.limit)}）`);
      }
      if (a.portName !== undefined && a.portName !== null && (typeof a.portName !== "string" || !a.portName.trim())) {
        return badArg("bad-port", "portName 必须是非空字符串（缺省 = 所有口）");
      }
      if (since > _receiveLog.seq) {
        // 池页面一 reload，序号从头再来 ⇒ 上一轮的游标会「超过水位」；此时若照常回空，AI 会以为
        // 「没有新数据」而永远读不到东西（seq 要从 1 长过旧游标才恢复）——如实报，并给出可用的游标。
        return {
          ok: false, noop: true, reason: "cursor-ahead", cursor: _receiveLog.seq,
          error: `游标 ${since} 超过当前水位 ${_receiveLog.seq}——接收日志已重启（池页面重载，序号从头再来）或这条游标不是本插件给的；用回执里的 cursor 重新拉`,
        };
      }
      const page = readReceiveLog(since, limit, a.portName?.trim() || undefined);
      if (page.items.length === 0) {
        return { ok: true, noop: true, reason: "no-new-data", items: [], cursor: page.cursor, lost: page.lost };
      }
      return { ok: true, items: page.items, cursor: page.cursor, count: page.items.length, lost: page.lost };
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

      const counts = new Map<string, number>();
      for (const item of _receiveLog.items) counts.set(item.portName, (counts.get(item.portName) ?? 0) + 1);
      const ports = new Map<string, { portName: string; count: number; open: boolean }>();
      for (const [portName, count] of counts) ports.set(portName, { portName, count, open: openPorts.includes(portName) });
      // 开着但一条都没收到（或他口）的口也列出来——AI 才能分辨「口没开」与「开了但设备没说话」
      for (const portName of openPorts) {
        if (!ports.has(portName)) ports.set(portName, { portName, count: 0, open: true });
      }
      return {
        ok: true,
        cursor: _receiveLog.seq,
        first: receiveLogFirst(),
        count: _receiveLog.items.length,
        capacity: RECEIVE_LOG_MAX,
        ports: [...ports.values()],
      };
    },
    { title: i18n.t("接收面水位"), category: cat, when: "false" },
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
      return {
        ok: true,
        count: sessions.length,
        activeSessionId: getActiveSessionId(),
        sessions: sessions.map((s) => {
          // 视图态读数的唯一来源：`_cmdMap`（每挂载一个串口视图写一格，键 = 会话 id）。
          // ⛔ 没挂载就报 null，⛔ 不报 false 假装问过——「标签页没开」与「暂停态是假的」不是一回事。
          const cmd = _cmdMap.get(s.id);
          return {
            sessionId: s.id,
            name: s.name,
            portName: s.port || null,
            open: hasOpenPort(s.port),
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
     那条会话可能根本没开标签页。视图只负责「按当前态换标题」，见 useToggleCommands。
     回执带 `field` / `previous` / `value`（改后回读）——⛔ 别让调用方从命令面板标题反推状态。 */
  const toggleNow = () => {
    const active = getActiveSessionId();
    return (active ? getSessionById(active) : undefined) ?? getSessions()[0] ?? null;
  };
  for (const spec of SESSION_TOGGLES) {
    const current = toggleNow();
    reg(spec.id, SESSION_TOGGLE_HANDLERS[spec.id], {
      title: i18n.t(spec.titleKey(current ? current[spec.field] : undefined)),
      category: cat,
      when: whenActive,
    });
  }

  // 17 = 九条动作/读数（AI#23/AI#64）＋ 两条寻址读（listPorts/listSessions）＋ 六条会话态开关
  return 9 + 2 + SESSION_TOGGLES.length;
}
