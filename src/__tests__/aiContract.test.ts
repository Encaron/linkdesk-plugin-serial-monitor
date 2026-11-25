/**
 * @vitest-environment jsdom
 * 05 案「门外 AI 契约补齐」——A 状态可信 / C 等待原语 / E 复位 / D1 时间基 的命令面判据。
 *
 * （B① 缓冲查询的取法/过滤判据在 receiveLog.test.ts——读数属主在那里，不在这里抄第二份。）
 *
 * 判据一句话：**门外 AI 不看界面也能一步恢复、一步等待、一步复位**——
 *   A：拔插后 openPort 不再撒谎（僵尸句柄 EDEVICE）、reopen 一步恢复、stale/devicePresent/state 如实随行；
 *   C：mark/afterMark/untilRegex/query——「发 → 睡 → 拉」的三步竞态收成一次调用，超时是正常结局；
 *   E：reset 只调既有 setDtr/setRts（零新 IPC），tookMs < 1s。
 *
 * 替身：`window.linkdesk.serial` / `commands` 等不在共享地基里（插件专属后门面）⇒ 就地铺记录式假件
 * （与 serialCommands.test.ts 同款口径，判据不同故不共用文件）。等待类测试用**真定时器**＋短超时
 * （150ms 级），不引假时钟——等待循环里还有 listPorts 探活，假时钟会把两边一起冻住。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { registerSerialCommands, _marks, _queryBusy } from "../services/serialCommands";
import {
  createSessionModule, getSessionById, updateSessionById,
} from "../hooks/useSerialSessions";
import { _sessionListeners, _store } from "../hooks/useSerialSessions/store";
import { _cmdMap, type ActiveCmd } from "../services/commandBridge";
import { deleteOpenPort, hasOpenPort, setOpenPort } from "../services/SerialContext/store";
import { _receiveLog, ensureReceiveLogSubscribed, writeReceiveLog } from "../services/receiveLog";
import { _resetSerialInbound } from "../services/serialInbound";

type CmdHandler = (...args: unknown[]) => unknown;
const handlers = new Map<string, CmdHandler>();
/** `serial.onData` 的订阅者表——扇出语义 */
let dataSubs: Array<(p: unknown) => void> = [];
/** listPorts 的可变返回（设备在场判据的真相源） */
let portsReply: Array<{ name: string; description: string }> = [];
let openArgs: unknown[] = [];
let closeCalls: string[] = [];
let dtrCalls: unknown[] = [];
let rtsCalls: unknown[] = [];
let sendTextCalls: unknown[][] = [];
/** 非空 ⇒ 假件的 sendText 抛错（ESENDFAIL 要造得出来） */
let sendFail: string | null = null;
/** getStatus 的可变返回（null = 该 API 不可用 / 未指定 ⇒ 按"壳句柄账"兜底） */
let statusReply: Array<{ portName: string; baudRate: number }> | null = null;
/** 假的壳句柄账——open/close 假件维护；直接 setOpenPort 的用例用 openShell() 同时登记 */
const shellOpenPorts = new Set<string>();
function openShell(port: string): void {
  setOpenPort(port, { baudRate: 115200, txBytes: 0, rxBytes: 0 });
  shellOpenPorts.add(port);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const emitData = (portName: string, text: string): void => {
  const payload = { portName, dir: "rx" as const, data: new TextEncoder().encode(`${text}\n`), at: Date.now() };
  for (const cb of [...dataSubs]) cb(payload);
};

beforeAll(() => {
  const lk = window.linkdesk as unknown as Record<string, unknown>;
  lk.commands = {
    registerCommand: (id: string, handler: CmdHandler) => { handlers.set(id, handler); },
    unregisterCommands: vi.fn(),
  };
  lk.pluginState = { set: () => Promise.resolve() };
  lk.contextKey = { set: () => Promise.resolve() };
  lk.tabs = { closeBySourceId: vi.fn() };
  lk.serial = {
    listPorts: async () => portsReply,
    openPort: async (cfg: unknown) => { openArgs.push(cfg as { portName?: string }); shellOpenPorts.add((cfg as { portName: string }).portName); },
    closePort: async (port: string) => { closeCalls.push(port); shellOpenPorts.delete(port); },
    getStatus: async (port?: string) => (port
      ? { portName: port, baudRate: 115200, isOpen: true }
      : (statusReply ?? [...shellOpenPorts].map((p) => ({ portName: p, baudRate: 115200 })))),
    setDtr: vi.fn(async (v: unknown) => { dtrCalls.push(v); }),
    setRts: vi.fn(async (v: unknown) => { rtsCalls.push(v); }),
    sendText: async (...a: unknown[]) => {
      if (sendFail) throw new Error(sendFail);
      sendTextCalls.push(a);
    },
    sendData: async () => {},
    onSystem: () => () => {},
    onStats: () => () => {},
    onData: (cb: (p: unknown) => void) => {
      dataSubs.push(cb);
      return () => { dataSubs = dataSubs.filter((x) => x !== cb); };
    },
  };
  registerSerialCommands();
});

/** 每例回到干净态——模块级单例手动清（同 serialCommands.test.ts 的 resetWorld 口径，加 05 案的两份） */
beforeEach(() => {
  _resetSerialInbound();
  _store.sessions = [];
  _store.activeSessionId = null;
  _store.sessionCounter = 0;
  _store.colorIndex = 0;
  _sessionListeners.clear();
  _cmdMap.clear();
  _marks.clear();
  _queryBusy.clear();
  _receiveLog.items = [];
  _receiveLog.seq = 0;
  _receiveLog.subscribed = false;
  _receiveLog.lastDataAt.clear();
  _receiveLog.openEpochs.clear();
  dataSubs = [];
  portsReply = [];
  openArgs = [];
  closeCalls = [];
  dtrCalls = [];
  rtsCalls = [];
  sendTextCalls = [];
  sendFail = null;
  statusReply = null;
  shellOpenPorts.clear();
  for (const p of ["COM3", "COM5", "COM9"]) deleteOpenPort(p);
});

/** 开一条绑口会话（命令腿的靶子） */
function bindSession(name: string, id: string, port: string): string {
  createSessionModule(name, id);
  updateSessionById(id, { port });
  return id;
}

/** 挂一个假视图（_cmdMap 一格）——视图态读数（paused/state）的唯一来源 */
function mountView(sessionId: string, paused: boolean): void {
  _cmdMap.set(sessionId, { paused } as unknown as ActiveCmd);
}

const call = (id: string, ...args: unknown[]) => handlers.get(id)!(...args) as Promise<Record<string, unknown>>;

/* ══ A 组 · 状态可信 ══ */

describe("A 组：设备在场 / stale / state 随行", () => {
  beforeEach(() => { ensureReceiveLogSubscribed(); });

  it("receiveStatus：devicePresent（在场 true / 拔掉 false）＋ lastDataAt/idleMs ＋ state.paused（视图暂停可见）", async () => {
    const sid = bindSession("会话1", "s-a1", "COM3");
    mountView(sid, true);
    openShell("COM3");
    writeReceiveLog("COM3", "hello");
    statusReply = [{ portName: "COM3", baudRate: 115200 }]; // 口开态读主进程（真源）

    portsReply = [{ name: "COM3", description: "USB-SERIAL" }];
    const here = await call("serial-monitor.receiveStatus");
    const port = (here.ports as Array<Record<string, unknown>>).find((p) => p.portName === "COM3");
    expect(port).toMatchObject({
      devicePresent: true, lastDataAt: expect.any(Number), idleMs: expect.any(Number),
      state: { paused: true, portOpen: true, devicePresent: true },
    });
    expect(here.lastDataAt).toBeTypeOf("number");
    expect(here.idleMs).toBeTypeOf("number");

    // 拔掉：清单里没了 ⇒ devicePresent:false、open 收紧为 false（❶ 状态必须被 OS 句柄验证）；视图还在 ⇒ paused 仍 true
    portsReply = [];
    const gone = await call("serial-monitor.receiveStatus");
    const portGone = (gone.ports as Array<Record<string, unknown>>).find((p) => p.portName === "COM3");
    expect(portGone).toMatchObject({ devicePresent: false, state: { paused: true, portOpen: false, devicePresent: false } });
  });

  it("readSince 回执随行 state；无视图 ⇒ paused:false（❻ paused 恒布尔）", async () => {
    const sid = bindSession("会话1", "s-a2", "COM3");
    portsReply = [{ name: "COM3", description: "USB-SERIAL" }];
    openShell("COM3");
    emitData("COM3", "x");

    const noView = await call("serial-monitor.readSince", { since: 0, portName: "COM3" });
    expect(noView).toMatchObject({ ok: true, state: { paused: false, portOpen: true, devicePresent: true } });

    mountView(sid, false);
    const mounted = await call("serial-monitor.readSince", { since: 0 });
    expect(mounted).toMatchObject({ ok: true, state: { paused: false, portOpen: true, devicePresent: true } });
  });

  it("listSessions 增 stale（绑着但设备不在 ⇒ true）——拔插 USB 后「open:true 撒谎」的解药（A3/❶）", async () => {
    const sid = bindSession("会话1", "s-a3", "COM3");
    openShell("COM3");

    portsReply = []; // 设备拔了
    const gone = await call("serial-monitor.listSessions");
    expect(gone.sessions).toMatchObject([{ sessionId: sid, open: false, devicePresent: false, stale: true }]);

    portsReply = [{ name: "COM3", description: "USB-SERIAL" }]; // 设备在
    const here = await call("serial-monitor.listSessions");
    expect(here.sessions).toMatchObject([{ sessionId: sid, open: true, devicePresent: true, stale: false }]);
  });

  it("openPort 遇僵尸句柄（壳账开着、设备不在）⇒ 摘账并如实 EDEVICE，⛔ 不再 alreadyOpen 撒谎（A5/❶）", async () => {
    openShell("COM3"); // 本地账面开着
    statusReply = [{ portName: "COM3", baudRate: 115200 }]; // 壳账也开着（僵尸）
    portsReply = []; // 设备拔了——僵尸

    const res = await call("serial-monitor.openPort", { portName: "COM3" });

    expect(res).toMatchObject({ isPluginError: true, code: "EDEVICE" });
    expect(hasOpenPort("COM3")).toBe(false); // 插件账清掉（灯灭、权威态注销）
    expect(closeCalls).toEqual(["COM3"]); // 壳账也走一次 close
  });

  it("reopen：关 → 等一小段 → 开（同一会话同参数）⇒ recovered:true（A4）；设备不在 ⇒ EDEVICE；没绑会话 ⇒ ENOSESSION", async () => {
    const sid = bindSession("会话1", "s-a4", "COM3");
    openShell("COM3");
    portsReply = [{ name: "COM3", description: "USB-SERIAL" }];

    const ok = await call("serial-monitor.reopen", { sessionId: sid });
    expect(ok).toMatchObject({ ok: true, sessionId: sid, portName: "COM3", recovered: true, reopened: true });
    expect(closeCalls).toEqual(["COM3"]);
    expect(openArgs.length).toBe(1); // 关了再开（同参）
    expect(ok.tookMs).toBeLessThan(5000);

    portsReply = []; // 设备不在就别白折腾
    const dev = await call("serial-monitor.reopen", { sessionId: sid });
    expect(dev).toMatchObject({ isPluginError: true, code: "EDEVICE" });
  });

  it("reopen：端口没绑在任何会话上 ⇒ ENOSESSION（同参恢复的参数无从读起）", async () => {
    portsReply = [{ name: "COM9", description: "USB-SERIAL" }];
    const nos = await call("serial-monitor.reopen", { portName: "COM9" });
    expect(nos).toMatchObject({ isPluginError: true, code: "ENOSESSION" });
  });
});

/* ══ C 组 · 等待原语 ══ */

describe("C 组：mark / afterMark / untilRegex / query", () => {
  beforeEach(() => { ensureReceiveLogSubscribed(); });

  it("mark：同名覆盖回 previous；afterMark 从打点处往后读；未知 ⇒ ENOMARK（C-1/C-2）", async () => {
    emitData("COM3", "boot");
    const m1 = await call("serial-monitor.mark", { name: "boot-start" });
    expect(m1).toMatchObject({ ok: true, name: "boot-start", cursor: 1, previous: null });

    emitData("COM3", "stage-2");
    const m2 = await call("serial-monitor.mark", { name: "boot-start" });
    expect(m2).toMatchObject({ ok: true, cursor: 2, previous: 1 }); // 同名覆盖

    emitData("COM3", "stage-3");
    const from = await call("serial-monitor.readSince", { afterMark: "boot-start" });
    expect(from).toMatchObject({ ok: true, count: 1, cursor: 3 });
    expect((from.items as Array<Record<string, unknown>>)[0].text).toBe("stage-3");

    const nomark = await call("serial-monitor.readSince", { afterMark: "nope" });
    expect(nomark).toMatchObject({ isPluginError: true, code: "ENOMARK" });
  });

  it("untilRegex：服务端阻塞等一行，命中即回（⌛ 客户端不用睡）", async () => {
    const p = call("serial-monitor.readSince", { untilRegex: "FatFs mounted", timeoutMs: 5000, portName: "COM3" });
    await sleep(120);
    expect(_queryBusy.size).toBe(0); // untilRegex 不占 query 的 busy（两条命令各管各的）
    emitData("COM3", "[SD] FatFs mounted ok");
    const res = await p;
    expect(res).toMatchObject({ ok: true, matched: true, line: "[SD] FatFs mounted ok", cursor: 1 });
    expect(res.tookMs).toBeLessThan(5000);
  });

  it("untilRegex 超时是正常结局：{ok:true, matched:false, timedOut:true}（03 E14，不是错误）", async () => {
    emitData("COM3", "无关行");
    const res = await call("serial-monitor.readSince", { untilRegex: "NEVER", timeoutMs: 150, portName: "COM3" });
    expect(res).toMatchObject({ ok: true, matched: false, timedOut: true, cursor: 1 });
    expect(res.tookMs).toBeGreaterThanOrEqual(100);
  });

  it("untilRegex 缺 timeoutMs ⇒ bad-timeout（⛔ 不设无限等）", async () => {
    const res = await call("serial-monitor.readSince", { untilRegex: "x" });
    expect(res).toMatchObject({ ok: false, noop: true, reason: "bad-timeout" });
  });

  it("query：发 ＋ 等应答一次调用，命中回命中行与沿途行（C-4）", async () => {
    bindSession("会话1", "s-c4", "COM3");
    openShell("COM3");
    const p = call("serial-monitor.query", { send: "AT+RST", expect: "ready", timeoutMs: 5000, portName: "COM3" });
    await sleep(120);
    emitData("COM3", "log line 1");
    emitData("COM3", "ready");
    const res = await p;
    expect(res).toMatchObject({ ok: true, matched: true, line: "ready", elapsedMs: expect.any(Number), cursor: 2 });
    expect((res.lines as Array<Record<string, unknown>>).map((i) => i.text)).toEqual(["log line 1", "ready"]);
    expect(sendTextCalls[0]).toEqual(["AT+RST", getSessionById("s-c4")?.sendCoding ?? "utf-8", "COM3"]);
  });

  it("query 超时：lines 带回已收到的内容（03 E17），不报错", async () => {
    bindSession("会话1", "s-c5", "COM3");
    openShell("COM3");
    const p = call("serial-monitor.query", { send: "AT", expect: "OK", timeoutMs: 150, portName: "COM3" });
    await sleep(60);
    emitData("COM3", "只言片语");
    const res = await p;
    expect(res).toMatchObject({ ok: true, matched: false, timedOut: true });
    expect((res.lines as Array<Record<string, unknown>>).map((i) => i.text)).toEqual(["只言片语"]);
  });

  it("同口并发 query ⇒ EBUSY（⛔ 不排队，03 E16）；发送失败 ⇒ ESENDFAIL", async () => {
    bindSession("会话1", "s-c6", "COM3");
    openShell("COM3");

    const q1 = call("serial-monitor.query", { send: "A", expect: "X", timeoutMs: 400, portName: "COM3" });
    await sleep(30);
    const busy = await call("serial-monitor.query", { send: "B", expect: "Y", timeoutMs: 300, portName: "COM3" });
    expect(busy).toMatchObject({ isPluginError: true, code: "EBUSY" });
    await q1; // 第一条等到超时收场，busy 位随之清掉
    expect(_queryBusy.size).toBe(0);

    sendFail = "写失败";
    const fail = await call("serial-monitor.query", { send: "A", expect: "X", timeoutMs: 100, portName: "COM3" });
    expect(fail).toMatchObject({ isPluginError: true, code: "ESENDFAIL" });
  });

  it("query：口没绑也没开 ⇒ ENOPORT（Q2 负控）", async () => {
    const noport = await call("serial-monitor.query", { send: "A", expect: "X", timeoutMs: 100 });
    expect(noport).toMatchObject({ isPluginError: true, code: "ENOPORT" });
  });
});

/* ══ E 组 · 复位 ══ */

describe("E 组：reset（DTR/RTS 电气复位）", () => {
  it("拉低 → 等 holdMs → 拉高；dtr 只动 DTR，both 两个一起动；tookMs < 1s（E-1 验收）", async () => {
    bindSession("会话1", "s-e1", "COM3");
    openShell("COM3");

    const dtr = await call("serial-monitor.reset", { method: "dtr", holdMs: 50, portName: "COM3" });
    expect(dtr).toMatchObject({ ok: true, portName: "COM3", method: "dtr", holdMs: 50 });
    expect(dtr.tookMs).toBeLessThan(1000);
    expect(dtrCalls).toEqual([false, true]);
    expect(rtsCalls).toEqual([]);

    dtrCalls = [];
    rtsCalls = [];
    const both = await call("serial-monitor.reset", { method: "both", holdMs: 50, portName: "COM3" });
    expect(both).toMatchObject({ ok: true, method: "both" });
    expect(dtrCalls).toEqual([false, true]);
    expect(rtsCalls).toEqual([false, true]);
  });

  it("负控：端口没开 ⇒ ENOPORT（E25）；method/holdMs 坏值在载荷里出声", async () => {
    bindSession("会话1", "s-e2", "COM3");
    const noport = await call("serial-monitor.reset", { method: "dtr", portName: "COM3" });
    expect(noport).toMatchObject({ isPluginError: true, code: "ENOPORT" });

    openShell("COM3");
    const badMethod = await call("serial-monitor.reset", { method: "magic", portName: "COM3" });
    expect(badMethod).toMatchObject({ ok: false, noop: true, reason: "bad-method" });
    const badHold = await call("serial-monitor.reset", { method: "dtr", holdMs: 99999, portName: "COM3" });
    expect(badHold).toMatchObject({ ok: false, noop: true, reason: "bad-hold" });
    expect(dtrCalls).toHaveLength(0); // 负控一条都没动电平
  });
});
