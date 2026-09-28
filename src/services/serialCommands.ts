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
import { SERIAL_CODINGS, SEND_MODE_HEX } from "../constants";
import { hasOpenPort } from "./SerialContext/store";
import {
  closePortFromModule, openPortFromModule, refreshPortsFromModule,
} from "./SerialContext/ipc";

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
        const names = getSessions().map((s) => s.name).join("、") || "（无）";
        throw new Error(`找不到会话（sessionId/name 都没有命中；现有：${names}）`);
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

  return 7;
}
