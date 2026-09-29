/**
 * @vitest-environment jsdom
 * 插件级命令注册（M2 `AI#23`）——判据两条腿，缺一条就是假绿：
 *
 *   ① **三处一起动**：AI 经命令开的口，**侧栏灯**（`pluginState <port>:isOpen` ＋ contextKey
 *      `serial-monitor.sourceOpen`）＋ **会话表**（`_store.sessions` 的 port ＋ `_openPorts` 权威态
 *      ＝ per-tab connected 派生源）＋ **`serial.system` 消息面**（插件注册的 `onSystem` 链路）三处
 *      表现与手点一致；并断言命令腿与手点腿写出的**灯写序列逐字相同**（顺序敏感——链上少一步、
 *      换个次序，这条就红）。
 *
 *   ② ⛔ **负控**：绕过插件直调 `linkdesk.serial.openPort` **必须不绿**——口开了、灯不亮、会话表
 *      不知道。这正是本条要防的假绿：只断言「口开了」的话，绕过插件那条路也会绿。
 *
 * 「手点腿」= `openPortFromModule`——UI 的 openPort action 逐字就是它（`useSerialContext.ts:52`），
 * ⇒ 对上述三个面而言「调它」即「手点」。本文件**不**另写一条链去模拟手点（那会造出第二条真相）。
 *
 * 替身：`window.linkdesk.serial` / `commands` / `pluginState` / `contextKey` / `dialog` 共享地基里
 * 都没有（插件专属后门面）⇒ 本文件就地铺一层记录式假件。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { registerSerialCommands } from "../services/serialCommands";
import {
  createSessionModule, getSessionById, getSessions, setActiveSessionId, updateSessionById,
} from "../hooks/useSerialSessions";
import { _cmdMap, type ActiveCmd } from "../services/commandBridge";
import { _sessionListeners, _store } from "../hooks/useSerialSessions/store";
import {
  deleteOpenPort, getOpenPorts, getSharedState, _setState,
} from "../services/SerialContext/store";
import { _registerIPCListeners, openPortFromModule } from "../services/SerialContext/ipc";

type CmdHandler = (...args: unknown[]) => unknown;
interface CmdMeta { title?: string; category?: string; when?: string; description?: string }

/* ── 假件：记录每一次写入，断言才看得见「三处」 ── */
const handlers = new Map<string, CmdHandler>();
const metas = new Map<string, CmdMeta>();
/** `[pluginId, key, value]`——pluginState 每次写入 */
let stateWrites: Array<[string, string, unknown]> = [];
/** `[key, value]`——contextKey 每次写入 */
let ctxWrites: Array<[string, unknown]> = [];
/** openPort 的 wire 实参（帧格式有没有真传到这一层） */
let openArgs: unknown[] = [];
let sendTextCalls: unknown[][] = [];
let closeBySourceIdCalls: string[] = [];
let systemHandler: ((p: unknown) => void) | undefined;
const confirmMock = vi.fn(async () => true);
/** listPorts 的可变返回——默认「一个口都没有」（本机 `SerialPort.list()` 就是空数组） */
let portsReply: Array<{ name: string; description: string }> = [];
/** 非空 ⇒ 假件的 `listPorts` 抛这个错（「问不出来」与「一个口都没有」是两件事，得分别造得出来） */
let portsFail: string | null = null;

/** 灯写序列——只挑 `:isOpen` 键（会话快照也写 pluginState，别把两种写混成一条序列） */
function lampSeq(): Array<[string, string, unknown]> {
  return stateWrites.filter(([, key]) => key.endsWith(":isOpen"));
}

beforeAll(() => {
  (window.linkdesk as unknown as Record<string, unknown>).commands = {
    registerCommand: (id: string, handler: CmdHandler, meta?: CmdMeta) => {
      handlers.set(id, handler);
      if (meta) metas.set(id, meta);
    },
    unregisterCommands: vi.fn(),
  };
  (window.linkdesk as unknown as Record<string, unknown>).pluginState = {
    set: (pluginId: string, key: string, value: unknown) => {
      stateWrites.push([pluginId, key, value]);
      return Promise.resolve();
    },
  };
  (window.linkdesk as unknown as Record<string, unknown>).contextKey = {
    set: (key: string, value: unknown) => {
      ctxWrites.push([key, value]);
      return Promise.resolve();
    },
  };
  (window.linkdesk as unknown as Record<string, unknown>).dialog = { confirm: confirmMock };
  (window.linkdesk as unknown as Record<string, unknown>).tabs = {
    closeBySourceId: (id: string) => { closeBySourceIdCalls.push(id); },
  };
  (window.linkdesk as unknown as Record<string, unknown>).serial = {
    listPorts: async () => {
      if (portsFail) throw new Error(portsFail);
      return portsReply;
    },
    openPort: async (cfg: unknown) => { openArgs.push(cfg); },
    closePort: async () => {},
    getStatus: async (port?: string) => (port ? { portName: port, baudRate: 115200, isOpen: true } : []),
    setDtr: vi.fn(async () => {}),
    setRts: vi.fn(async () => {}),
    sendText: async (...a: unknown[]) => { sendTextCalls.push(a); },
    sendData: async () => {},
    onSystem: (cb: (p: unknown) => void) => { systemHandler = cb; return () => { systemHandler = undefined; }; },
    onStats: () => () => {},
    onData: () => () => {},
  };
  // 插件在真机里由视图 mount 触发；这里手动注册一次（引用计数首调即真注册，监听器常驻整个文件）
  _registerIPCListeners();
  registerSerialCommands();
});

/** 每个例前回到干净态——模块级单例得手动清（resetAll 只在 React 腿里） */
function resetWorld(): void {
  _store.sessions = [];
  _store.activeSessionId = null;
  _store.sessionCounter = 0;
  _store.colorIndex = 0;
  _sessionListeners.clear();
  _cmdMap.clear();
  _setState(() => ({ ports: [], sourceName: "", baudRate: "115200", isOpen: false, lastError: null }));
  for (const p of ["COM3", "COM5", "COM9"]) deleteOpenPort(p);
  stateWrites = [];
  ctxWrites = [];
  openArgs = [];
  sendTextCalls = [];
  closeBySourceIdCalls = [];
  portsReply = [];
  portsFail = null;
  confirmMock.mockReset();
  confirmMock.mockImplementation(async () => true);
  (window as unknown as { __ldkConfigStore: Map<string, unknown> }).__ldkConfigStore.clear();
}

beforeEach(resetWorld);

describe("命令注册面", () => {
  it("17 条插件级命令全部注册（九条动作/读数 ＋ 两条寻址读 ＋ 六条会话态开关）", () => {
    // ⚠️ 声明面的 `description` / `params` 覆盖**不在这里断言**：本仓 tsconfig 不带 node 类型，
    //    读 `plugin.json` 会引入 `node:fs` / `process` 的类型错。那条判据的机械尺子是
    //    壳仓 `scripts/audit-plugin-commands.mjs`（AI#28）——跨仓验收时跑它，别在本文件写第二把。
    expect(registerSerialCommands()).toBe(17);
    for (const id of [
      "serial-monitor.openPort", "serial-monitor.closePort", "serial-monitor.closeSession",
      "serial-monitor.setSendCoding", "serial-monitor.send",
      "serial-monitor.quickSendEdit", "serial-monitor.quickSendDelete",
      "serial-monitor.readSince", "serial-monitor.receiveStatus",
      "serial-monitor.listPorts", "serial-monitor.listSessions",
      "serial-monitor.toggleSendMode", "serial-monitor.toggleEcho", "serial-monitor.toggleLineNumbers",
      "serial-monitor.toggleSystemLog", "serial-monitor.toggleAutoRepeat", "serial-monitor.toggleAutoClear",
    ]) {
      expect(handlers.has(id), `${id} 未注册`).toBe(true);
    }
  });

  it("send 与四条读数是 when:false 的程序化命令（不进命令面板），其余十条挂 activeEditor 门", () => {
    expect(metas.get("serial-monitor.send")?.when).toBe("false");
    expect(metas.get("serial-monitor.readSince")?.when).toBe("false");
    expect(metas.get("serial-monitor.receiveStatus")?.when).toBe("false");
    expect(metas.get("serial-monitor.listSessions")?.when).toBe("false");
    expect(metas.get("serial-monitor.listPorts")?.when).toBe("false");
    for (const id of [
      "serial-monitor.openPort", "serial-monitor.closePort", "serial-monitor.closeSession", "serial-monitor.setSendCoding",
      "serial-monitor.toggleSendMode", "serial-monitor.toggleEcho", "serial-monitor.toggleLineNumbers",
      "serial-monitor.toggleSystemLog", "serial-monitor.toggleAutoRepeat", "serial-monitor.toggleAutoClear",
    ]) {
      expect(metas.get(id)?.when).toBe("activeEditor == 'serial-monitor'");
    }
  });
});

describe("AI#23 判据①：打开端口——三处一起动（与手点同链）", () => {
  it("经命令开 COM3：灯亮 ＋ 会话表绑上口 ＋ 系统消息面收得到", async () => {
    const res = await handlers.get("serial-monitor.openPort")!({ portName: "COM3", baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" }) as {
      opened: boolean; sessionId: string; portName: string; baudRate: number; frame: unknown;
    };

    expect(res.opened).toBe(true);
    expect(res.portName).toBe("COM3");

    // ① 侧栏灯（真相源）——per-port 键 + 投影 contextKey 一起亮
    expect(stateWrites).toContainEqual(["serial-monitor", "COM3:isOpen", true]);
    expect(ctxWrites).toContainEqual(["serial-monitor.sourceOpen", true]);
    expect(getOpenPorts().has("COM3")).toBe(true); // 每口权威态（per-tab connected 派生源）

    // ② 会话表——口绑在这条会话上，且波特率也落回会话（AI 传的 9600 不是只发给 wire）
    const session = getSessionById(res.sessionId)!;
    expect(session.port).toBe("COM3");
    expect(session.baudRate).toBe("9600");
    expect(getSessions().filter((s) => s.port === "COM3")).toHaveLength(1);

    // ③ serial.system 消息面——主进程开口气息经插件注册的 onSystem 链路进来（视图不在场也收得到）
    expect(systemHandler).toBeTypeOf("function");
    systemHandler!({ type: "status", portName: "COM3", message: "COM3 已打开" });
    expect(getSharedState().lastError).toBe("COM3 已打开");

    // 帧格式真到了 wire 层——AI 选的 8N1 不是写进会话就完事
    expect(openArgs[0]).toMatchObject({ portName: "COM3", baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" });
  });

  it("命令腿与手点腿的灯写序列逐字相同（顺序敏感——少一步/换次序即红）", async () => {
    const open = handlers.get("serial-monitor.openPort")!;

    const cmdLeg = await (async () => {
      resetWorld();
      await open({ portName: "COM3", baudRate: 115200 });
      return { lamp: lampSeq(), ctx: [...ctxWrites] };
    })();

    const manualLeg = await (async () => {
      resetWorld();
      // 手点腿 = UI 的 openPort action 逐字那一步（useSerialContext.ts:52）——会话值与命令腿同源（cloneDefaults）
      const s = createSessionModule("会话");
      await openPortFromModule({
        portName: "COM3", baudRate: Number(s.baudRate || 115200), encoding: s.receiveCoding,
        frame: { dataBits: s.dataBits ?? 8, stopBits: s.stopBits ?? 1, parity: s.parity ?? "none" },
        handshake: { dtr: Boolean(s.dtr), rts: Boolean(s.rts) },
      });
      return { lamp: lampSeq(), ctx: [...ctxWrites] };
    })();

    expect(cmdLeg.ctx).toEqual(manualLeg.ctx);
    expect(cmdLeg.lamp).toEqual(manualLeg.lamp);
    // 序列里确实有「亮」这一笔（防两边都空着也判相等）
    expect(cmdLeg.lamp).toContainEqual(["serial-monitor", "COM3:isOpen", true]);
  });

  it("口已开时再开 = 不动（不是翻转）：如实回 alreadyOpen，灯不重复写", async () => {
    const open = handlers.get("serial-monitor.openPort")!;
    await open({ portName: "COM3", baudRate: 115200 });
    stateWrites = [];
    openArgs = [];

    const again = await open({ portName: "COM3" }) as { opened: boolean; alreadyOpen?: boolean };

    expect(again.opened).toBe(false);
    expect(again.alreadyOpen).toBe(true);
    expect(lampSeq()).toHaveLength(0);
    expect(openArgs).toHaveLength(0);
  });

  it("一个口都没有时如实报错（本机 SerialPort.list() 就是空数组）——不是静默无事发生", async () => {
    portsReply = [];
    await expect(handlers.get("serial-monitor.openPort")!({})).rejects.toThrow(/没有可用串口/);
  });

  it("会话没绑口时取列表第一个可用口（与界面「打开」同判据）", async () => {
    portsReply = [{ name: "COM5", description: "USB-SERIAL" }];
    const res = await handlers.get("serial-monitor.openPort")!({}) as { portName: string; sessionId: string };

    expect(res.portName).toBe("COM5");
    expect(getSessionById(res.sessionId)?.port).toBe("COM5");
    expect(stateWrites).toContainEqual(["serial-monitor", "COM5:isOpen", true]);
  });
});

describe("AI#23 判据②：负控——绕过插件直调 API 必须不绿", () => {
  it("直调 linkdesk.serial.openPort：口开了但灯不亮、会话表不知道（＝本条要防的假绿）", async () => {
    await (window.linkdesk as unknown as { serial: { openPort: (c: unknown) => Promise<void> } })
      .serial.openPort({ portName: "COM9", baudRate: 115200 });

    // 「口开了」这件事本身是真的——这正是假绿为什么危险（这条断言也防本例空过：没打到就没得说）
    expect(openArgs).toHaveLength(1);
    // 但三处一处都没动：
    expect(lampSeq()).toHaveLength(0);
    expect(ctxWrites).toHaveLength(0);
    expect(getOpenPorts().has("COM9")).toBe(false);
    expect(getSessions().some((s) => s.port === "COM9")).toBe(false);
  });
});

describe("关闭端口 / 关闭会话", () => {
  it("关端口按口熄灯（per-port 键 + contextKey），权威态注销", async () => {
    await handlers.get("serial-monitor.openPort")!({ portName: "COM3", baudRate: 115200 });
    stateWrites = [];
    ctxWrites = [];

    const res = await handlers.get("serial-monitor.closePort")!({ portName: "COM3" }) as { closed: boolean };

    expect(res.closed).toBe(true);
    expect(stateWrites).toContainEqual(["serial-monitor", "COM3:isOpen", false]);
    expect(ctxWrites).toContainEqual(["serial-monitor.sourceOpen", false]);
    expect(getOpenPorts().has("COM3")).toBe(false);
  });

  it("关没开着的口：如实回 alreadyClosed，不假装关过", async () => {
    const res = await handlers.get("serial-monitor.closePort")!({ portName: "COM3" }) as { closed: boolean; alreadyClosed?: boolean };
    expect(res).toMatchObject({ closed: false, alreadyClosed: true });
  });

  it("关会话：先断口 → 关标签页 → 删会话（与侧栏 ✕ 同一顺序）", async () => {
    const open = await handlers.get("serial-monitor.openPort")!({ portName: "COM3", baudRate: 115200 }) as { sessionId: string };
    (window as unknown as { __ldkConfigStore: Map<string, unknown> }).__ldkConfigStore.set("serial-monitor.confirmOnClose", false);

    const res = await handlers.get("serial-monitor.closeSession")!({ sessionId: open.sessionId }) as { closed: boolean; portDisconnected: boolean };

    expect(res).toMatchObject({ closed: true, portDisconnected: true });
    expect(getSessionById(open.sessionId)).toBeUndefined();
    expect(closeBySourceIdCalls).toEqual([open.sessionId]);
    expect(getOpenPorts().has("COM3")).toBe(false);
    // 确认框没弹（配置关着 + 没传 confirm 也一样不弹）
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("「关闭时提示」开着且用户不点头 ⇒ 如实回 denied，会话/标签页/口一处不动", async () => {
    const open = await handlers.get("serial-monitor.openPort")!({ portName: "COM3", baudRate: 115200 }) as { sessionId: string };
    confirmMock.mockResolvedValue(false); // 配置缺省 = 提示开

    const res = await handlers.get("serial-monitor.closeSession")!({ sessionId: open.sessionId }) as { closed: boolean; denied?: boolean };

    expect(res).toMatchObject({ closed: false, denied: true });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(getSessionById(open.sessionId)).toBeDefined();
    expect(closeBySourceIdCalls).toHaveLength(0);
    expect(getOpenPorts().has("COM3")).toBe(true);
  });

  it("AI 侧传 confirm:true 可跳过确认框（否则无人应答的模态把调用挂死）", async () => {
    const open = await handlers.get("serial-monitor.openPort")!({ portName: "COM3", baudRate: 115200 }) as { sessionId: string };

    const res = await handlers.get("serial-monitor.closeSession")!({ sessionId: open.sessionId, confirm: true }) as { closed: boolean };

    expect(res.closed).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("找不到会话时报可读错（带上现有会话名），不是静默成功", async () => {
    createSessionModule("甲");
    createSessionModule("乙");
    await expect(handlers.get("serial-monitor.closeSession")!({ sessionId: "s-nope" })).rejects.toThrow(/找不到会话.*甲/s);
  });
});

describe("发送编码 / 发送 / 快捷发送", () => {
  it("setSendCoding 取值限于下拉那一套（防「命令设得进、下拉选不出」）", async () => {
    const s = createSessionModule("会话");
    const ok = await handlers.get("serial-monitor.setSendCoding")!({ coding: "GB2312", sessionId: s.id }) as { sendCoding: string };
    expect(ok.sendCoding).toBe("GB2312");
    expect(getSessionById(s.id)?.sendCoding).toBe("GB2312");

    await expect(handlers.get("serial-monitor.setSendCoding")!({ coding: "Koi8-R", sessionId: s.id })).rejects.toThrow(/不支持的编码/);
    expect(getSessionById(s.id)?.sendCoding).toBe("GB2312"); // 拒了就一点没改
  });

  it("send 不传编码时用目标会话的发送编码（AI#10 的编码入口就这一处）", async () => {
    const s = createSessionModule("会话");
    await handlers.get("serial-monitor.setSendCoding")!({ coding: "Shift-JIS", sessionId: s.id });

    await handlers.get("serial-monitor.send")!("text", "你好", undefined);

    expect(sendTextCalls[0]).toEqual(["你好", "Shift-JIS", undefined]);
  });

  it("send 显式传编码优先于会话设置（单条临时编码不改设置）", async () => {
    const s = createSessionModule("会话");
    await handlers.get("serial-monitor.setSendCoding")!({ coding: "GB2312", sessionId: s.id });

    await handlers.get("serial-monitor.send")!("text", "hi", undefined, "Latin-1");

    expect(sendTextCalls[0]).toEqual(["hi", "Latin-1", undefined]);
    expect(getSessionById(s.id)?.sendCoding).toBe("GB2312");
  });

  it("quickSendDelete 无视图也能删（会话数据是模块级）——只动目标那颗", async () => {
    const s = createSessionModule("会话");
    // 默认带一颗 "AT"；再加一颗，验证「只删点名的」
    updateSessionById(s.id, { quickSends: { AT: "AT", PING: "ping" } });

    const res = await handlers.get("serial-monitor.quickSendDelete")!({ quickSendName: "AT", sessionId: s.id }) as { deleted: boolean };

    expect(res.deleted).toBe(true);
    expect(getSessionById(s.id)?.quickSends).toEqual({ PING: "ping" });
  });

  it("quickSendEdit 无视图时给可读报错（编辑框是视图态），不是 null 解引用炸栈", async () => {
    await expect(handlers.get("serial-monitor.quickSendEdit")!({ quickSendName: "AT" }))
      .rejects.toThrow(/需要打开该会话的串口标签页/);
  });
});

/**
 * 会话寻址（M2 `AI#67`）——外部 AI 0.2.25 复测里那句「开关按不动」的实证：多串口下会话是多条
 * **并立**的（会话1 的系统消息独立显示是开的、会话2 是关的），而旧命令面只有「活跃会话」一个
 * 隐含目标 ⇒ 门外既看不见有哪几条，也无法点名改某一条。本块守两面：
 *   读 `listSessions`（有哪几条 / 谁是活跃 / 每条现况 / 视图在不在场）
 *   写 六条开关的 `sessionId`（点名改的就是它，⛔ 不静默落到活跃会话上）
 */
describe("AI#67 会话寻址：listSessions ＋ 六条开关认 sessionId", () => {
  /** 挂一格视图态读数——真机里由 SerialMonitorView mount 写入 */
  function mountView(id: string, paused: boolean): void {
    _cmdMap.set(id, { paused, cmView: { current: null } } as unknown as ActiveCmd);
  }

  it("listPorts 枚举机器上的口：谁开着、在哪条会话上，且与界面下拉同一条腿", async () => {
    const s1 = createSessionModule("会话1", "s-1");
    updateSessionById(s1.id, { port: "COM3" });
    portsReply = [
      { name: "COM3", description: "USB-SERIAL CH340" },
      { name: "COM7", description: "" },
    ];
    await openPortFromModule({ portName: "COM3", baudRate: 115200 });

    const res = await handlers.get("serial-monitor.listPorts")!() as {
      ok: boolean; count: number;
      ports: Array<{ portName: string; description: string | null; open: boolean; sessionId: string | null }>;
    };

    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
    // 门前两步齐了：挑口（portName）＋ 拿 sessionId 去寻址；开着的那口如实报 open
    expect(res.ports[0]).toEqual({ portName: "COM3", description: "USB-SERIAL CH340", open: true, sessionId: "s-1" });
    expect(res.ports[1]).toEqual({ portName: "COM7", description: null, open: false, sessionId: null });
    // 同一条腿：界面下拉读的那份共享态也被刷新（读数与 UI 不可能分叉）
    expect(getSharedState().ports.map((p) => p.name)).toEqual(["COM3", "COM7"]);
  });

  it("一个口都没有 ⇒ 如实报空（ok:true/ports:[]），⛔ 不报错也不虚报", async () => {
    const res = await handlers.get("serial-monitor.listPorts")!() as { ok: boolean; count: number; ports: unknown[] };

    expect(res).toMatchObject({ ok: true, count: 0, ports: [] });
  });

  it("读口失败 ⇒ 载荷里出声（read-failed）——「问不出来」≠「一个口都没有」", async () => {
    portsFail = "Access denied";
    const res = await handlers.get("serial-monitor.listPorts")!() as {
      ok: boolean; noop: boolean; reason: string; error: string;
    };

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("read-failed");
    expect(res.error).toMatch(/Access denied/);
    expect(res.error).toMatch(/不等于一个口都没有/);
  });

  it("listSessions 枚举全部会话：谁活跃、每条现况、端口开没开", async () => {
    const s1 = createSessionModule("会话1", "s-1");
    const s2 = createSessionModule("会话2", "s-2");
    updateSessionById(s1.id, { port: "COM3" });
    updateSessionById(s2.id, { port: "COM5", sendMode: "hex", separateSystemLog: false });
    await openPortFromModule({ portName: "COM3", baudRate: 115200 }); // 只有 COM3 真开着
    setActiveSessionId(s2.id);

    const res = await handlers.get("serial-monitor.listSessions")!() as {
      ok: boolean; count: number; activeSessionId: string | null;
      sessions: Array<Record<string, unknown>>;
    };

    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
    expect(res.activeSessionId).toBe("s-2"); // 活跃 ≠ 第一条：门外的「当前」得看得见
    expect(res.sessions.map((s) => s.sessionId)).toEqual(["s-1", "s-2"]);
    expect(res.sessions[0]).toMatchObject({ name: "会话1", portName: "COM3", open: true, sendMode: "text" });
    expect(res.sessions[1]).toMatchObject({ name: "会话2", portName: "COM5", open: false, sendMode: "hex", separateSystemLog: false });
  });

  it("视图没挂载 ⇒ viewMounted:false ＋ paused:null（⛔ 不报 false 假装问过）", async () => {
    createSessionModule("会话1", "s-1");
    mountView("s-1", true);

    const res = await handlers.get("serial-monitor.listSessions")!() as {
      sessions: Array<{ sessionId: string; viewMounted: boolean; paused: boolean | null }>;
    };

    expect(res.sessions[0]).toMatchObject({ viewMounted: true, paused: true }); // 挂载过 —— 读的是视图态快照
    _cmdMap.clear();
    const bare = await handlers.get("serial-monitor.listSessions")!() as typeof res;
    // 「标签页没开」与「暂停态是假的」不是一回事——没挂载就如实说不知道
    expect(bare.sessions[0]).toMatchObject({ viewMounted: false, paused: null });
  });

  it("⛔ 点名哪条就改哪条：给了 sessionId 的开关不落到活跃会话上（外部 AI 那条误判的正面判据）", async () => {
    const s1 = createSessionModule("会话1", "s-1");
    const s2 = createSessionModule("会话2", "s-2");
    updateSessionById(s1.id, { separateSystemLog: true });
    updateSessionById(s2.id, { separateSystemLog: false });
    setActiveSessionId(s1.id); // 活跃 = 会话1（开的）——若按旧语义，改「会话2」会落到会话1

    const res = await handlers.get("serial-monitor.toggleSystemLog")!({ sessionId: "s-2" }) as {
      ok: boolean; sessionId: string; name: string; field: string;
      value: boolean; previous: boolean;
    };

    // 回执自带读数（field/previous/value）——标题不用再兼职当读数
    expect(res).toMatchObject({ ok: true, sessionId: "s-2", name: "会话2", field: "separateSystemLog", previous: false, value: true });
    expect(getSessionById("s-2")?.separateSystemLog).toBe(true);
    expect(getSessionById("s-1")?.separateSystemLog).toBe(true); // 活跃那条一个字节没动
  });

  it("缺省仍按旧语义走活跃会话（没给 sessionId 的老调用不受影响）", async () => {
    const s1 = createSessionModule("会话1", "s-1");
    const s2 = createSessionModule("会话2", "s-2");
    updateSessionById(s2.id, { showEcho: false });
    setActiveSessionId(s2.id);
    const untouched = getSessionById(s1.id)?.showEcho; // 默认值随 cloneDefaults 走——比「没动」而不是猜具体值

    const res = await handlers.get("serial-monitor.toggleEcho")!() as { sessionId: string; value: boolean };

    expect(res).toMatchObject({ sessionId: "s-2", value: true });
    expect(getSessionById(s1.id)?.showEcho).toBe(untouched); // 第一条没被顺手改
  });

  it("坏 sessionId ⇒ 坏回执（noop）＋现有清单，⛔ 不静默落到别的会话上", async () => {
    createSessionModule("会话1", "s-1");
    const untouched = getSessionById("s-1")?.showEcho;
    const res = await handlers.get("serial-monitor.toggleEcho")!({ sessionId: "s-nope" }) as {
      ok: boolean; noop: boolean; reason: string; error: string;
    };

    // 门外能自己纠正：错在哪、有哪些可用
    expect(res.ok).toBe(false);
    expect(res.noop).toBe(true);
    expect(res.reason).toBe("bad-session");
    expect(res.error).toMatch(/找不到会话 "s-nope"/);
    expect(res.error).toMatch(/会话1\[s-1\]/); // 顺带把清单给了 —— 不用再来问一次
    expect(getSessionById("s-1")?.showEcho).toBe(untouched);

    // 非字符串同样如实报（⛔ 不让 42 变成「第一条会话」）
    const bad = await handlers.get("serial-monitor.toggleEcho")!(42) as { reason: string; error: string };
    expect(bad.reason).toBe("bad-session");
    expect(bad.error).toMatch(/必须是非空字符串/);
  });

  it("一条会话都没有 ⇒ no-session 坏回执（⛔ 不偷偷建——建会话语义归 openPort）", async () => {
    const res = await handlers.get("serial-monitor.toggleLineNumbers")!() as { ok: boolean; reason: string };

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no-session");
    expect(getSessions()).toHaveLength(0);
  });

  it("六条开关同形：每条只翻自己那个字段，并回读改后的值", async () => {
    const s = createSessionModule("会话1", "s-1");
    const fields = ["sendMode", "showEcho", "showLineNumbers", "separateSystemLog", "autoRepeat", "autoClear"] as const;
    const before = { ...getSessionById(s.id)! };

    for (const id of [
      "serial-monitor.toggleSendMode", "serial-monitor.toggleEcho", "serial-monitor.toggleLineNumbers",
      "serial-monitor.toggleSystemLog", "serial-monitor.toggleAutoRepeat", "serial-monitor.toggleAutoClear",
    ]) {
      const res = await handlers.get(id)!({ sessionId: "s-1" }) as { ok: boolean; field: string; value: unknown; previous: unknown };
      const field = res.field as typeof fields[number];
      expect(fields).toContain(field);
      // 回执里的 value 是**读回来的**（与真值一致），不是「打算写的那个」
      expect(res.value).toBe(getSessionById("s-1")![field]);
      expect(res.previous).toBe(before[field]);
      expect(res.value).not.toBe(res.previous);
    }

    // 六个字段逐个都翻过了（每个都与翻前不同），其余字段仍是原值（没有哪条顺手改了别的）
    const after = getSessionById(s.id)!;
    expect(fields.every((f) => after[f] !== before[f])).toBe(true);
    expect(after.name).toBe(before.name);
    expect(after.port).toBe(before.port);
    expect(after.sendCoding).toBe(before.sendCoding);
    expect(after.receiveCoding).toBe(before.receiveCoding);
  });
});
