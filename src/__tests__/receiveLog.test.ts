/**
 * @vitest-environment jsdom
 * 接收日志 ＋ 拉取式读数命令（M2 `AI#64`）——判据一句话：**门③ 的 AI 拿「游标 → items → cursor」读得到回声**。
 *
 * 三条腿，缺一条就是假绿：
 *   ① **日志本体**：序号单调、跨口连续、容量滚出后 `first` 前移且 `lost` 如实（⛔ 不静默补空）；
 *   ② **订阅面**：`ensureReceiveLogSubscribed` 幂等、**进程级常驻**，且与视图那条订阅**并存互不抢**
 *      （真机依据：`events.on` 给每个订阅者各注册一条 `ipcRenderer.on`，本文件的替身按同一扇出语义铺）；
 *   ③ **命令面**：三态回执逐形（有新数据 / 没有新的 / 调用不成立），坏参**载荷里出声且不抛**
 *      （照壳侧 `AI#62` 判例），两形入参等价。
 *
 * 替身：`window.linkdesk.serial` / `commands` 不在共享地基里（插件专属后门面）⇒ 就地铺记录式假件。
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { registerSerialCommands } from "../services/serialCommands";
import {
  _receiveLog, ensureReceiveLogSubscribed, readReceiveLog, receiveLogFirst, writeReceiveLog,
} from "../services/receiveLog";
import { RECEIVE_LOG_MAX, RECEIVE_READ_LIMIT_DEFAULT } from "../constants";
import { deleteOpenPort, setOpenPort } from "../services/SerialContext/store";

type CmdHandler = (...args: unknown[]) => unknown;
const handlers = new Map<string, CmdHandler>();
/** `serial.onData` 的订阅者表——**扇出**语义（真机由 events.on 每人一条 ipcRenderer.on 保证） */
let dataSubs: Array<(p: unknown) => void> = [];
/** `serial.getStatus()`（主进程真源）的可变返回——null = 该 API 不可用（测退回本地集合那条路） */
let statusReply: Array<{ portName: string }> | null = [];
/** 记录式假件：视图那条链的订阅（用来证明两路并存） */
let viewStream: Array<{ portName: string; text: string }> = [];

/** 主进程广播一条数据——所有订阅者各收一份（扇出） */
function emitData(portName: string, text: string): void {
  for (const cb of [...dataSubs]) cb({ portName, text });
}

beforeAll(() => {
  (window.linkdesk as unknown as Record<string, unknown>).commands = {
    registerCommand: (id: string, handler: CmdHandler) => { handlers.set(id, handler); },
    unregisterCommands: vi.fn(),
  };
  (window.linkdesk as unknown as Record<string, unknown>).serial = {
    onData: (cb: (p: unknown) => void) => {
      dataSubs.push(cb);
      return () => { dataSubs = dataSubs.filter((x) => x !== cb); };
    },
    getStatus: async () => statusReply,
  };
  (window.linkdesk as unknown as Record<string, unknown>).pluginState = { set: () => Promise.resolve() };
  (window.linkdesk as unknown as Record<string, unknown>).contextKey = { set: () => Promise.resolve() };
  registerSerialCommands();
});

beforeEach(() => {
  _receiveLog.items = [];
  _receiveLog.seq = 0;
  _receiveLog.subscribed = false;
  dataSubs = [];
  viewStream = [];
  statusReply = [];
  for (const p of ["COM3", "COM5", "COM9"]) deleteOpenPort(p);
});

/** 命令腿的前置：把订阅挂上（真机由 `src/index.tsx` 入口顶层做） */
function subscribe(): void {
  ensureReceiveLogSubscribed();
}

const pull = (...args: unknown[]) => handlers.get("serial-monitor.readSince")!(...args) as Promise<Record<string, unknown>>;
const status = () => handlers.get("serial-monitor.receiveStatus")!() as Promise<Record<string, unknown>>;

describe("订阅面：进程级常驻 ＋ 幂等 ＋ 与视图并存", () => {
  it("挂上即收（入口顶层那条腿）——幂等：调两次只挂一条", () => {
    expect(ensureReceiveLogSubscribed()).toBe(true);
    expect(ensureReceiveLogSubscribed()).toBe(true);
    expect(dataSubs).toHaveLength(1);

    emitData("COM3", "OK");
    expect(_receiveLog.items).toHaveLength(1);
    expect(_receiveLog.items[0]).toMatchObject({ seq: 1, portName: "COM3", text: "OK", hex: "4F 4B" });
    expect(_receiveLog.items[0].ts).toBeTypeOf("number");
  });

  it("无串口面 ⇒ 如实回 false（⛔ 不假装收着）", () => {
    const face = (window.linkdesk as unknown as Record<string, unknown>).serial;
    delete (window.linkdesk as unknown as Record<string, unknown>).serial;
    expect(ensureReceiveLogSubscribed()).toBe(false);
    expect(_receiveLog.subscribed).toBe(false);
    (window.linkdesk as unknown as Record<string, unknown>).serial = face;
  });

  it("与视图那条订阅扇出并存——两边都收到同一条（⛔ 不抢事件）", () => {
    subscribe();
    // 视图链的替身：登记第二个订阅者（真机里就是 useSerialIpcEvents 那条）
    dataSubs.push((p) => {
      const q = p as { portName: string; text: string };
      viewStream.push({ portName: q.portName, text: q.text });
    });

    emitData("COM5", "echo-1");

    expect(viewStream).toEqual([{ portName: "COM5", text: "echo-1" }]);
    expect(_receiveLog.items.map((i) => i.text)).toEqual(["echo-1"]);
  });
});

describe("日志本体：序号 / 容量 / 游标", () => {
  it("序号跨口单调（游标是全局面上的位置）", () => {
    writeReceiveLog("COM3", "a");
    writeReceiveLog("COM5", "b");
    writeReceiveLog("COM3", "c");
    expect(_receiveLog.items.map((i) => i.seq)).toEqual([1, 2, 3]);
    expect(receiveLogFirst()).toBe(1);
  });

  it("空日志的 first = 水位 + 1（还没有任何一条）", () => {
    expect(receiveLogFirst()).toBe(1);
    writeReceiveLog("COM3", "a");
    expect(receiveLogFirst()).toBe(1);
    _receiveLog.items = []; // 只清缓冲不退回序号（模拟「扩容前已滚出」的极端态）
    expect(receiveLogFirst()).toBe(2);
  });

  it("容量满滚出最老 ⇒ first 前移、lost 如实报条数（⛔ 不静默）", () => {
    for (let i = 1; i <= RECEIVE_LOG_MAX + 5; i++) writeReceiveLog("COM3", `line-${i}`);
    expect(_receiveLog.items).toHaveLength(RECEIVE_LOG_MAX);
    expect(receiveLogFirst()).toBe(6);

    const page = readReceiveLog(0, 10);
    expect(page.lost).toBe(5); // 序号 1–5 已滚出，读不到
    expect(page.items[0].seq).toBe(6);
    expect(page.items[0].text).toBe("line-6");
    // 没落后的游标 lost = 0
    expect(readReceiveLog(5, 10).lost).toBe(0);
  });

  it("portName 过滤只挑本口，但游标仍按全局位置前进", () => {
    writeReceiveLog("COM5", "他口-1");
    writeReceiveLog("COM3", "本口-1");
    writeReceiveLog("COM5", "他口-2");
    writeReceiveLog("COM3", "本口-2");

    const page = readReceiveLog(0, 10, "COM3");
    expect(page.items.map((i) => i.text)).toEqual(["本口-1", "本口-2"]);
    // 游标 = 最后一条本口的 seq（4）——他口的 1/2 也在它之前（全局面上的位置）
    expect(page.cursor).toBe(4);
  });

  it("limit 截断，cursor = 最后一条返回项的 seq（拿它续读）", () => {
    for (let i = 1; i <= 5; i++) writeReceiveLog("COM3", `l${i}`);
    const first = readReceiveLog(0, 2);
    expect(first.items.map((i) => i.seq)).toEqual([1, 2]);
    expect(first.cursor).toBe(2);

    const second = readReceiveLog(first.cursor, 2);
    expect(second.items.map((i) => i.seq)).toEqual([3, 4]);
    expect(second.cursor).toBe(4);
  });

  it("纯读幂等——同一游标调两次回一样，日志不动", () => {
    writeReceiveLog("COM3", "x");
    const a = readReceiveLog(0, 10);
    const b = readReceiveLog(0, 10);
    expect(a).toEqual(b);
    expect(_receiveLog.items).toHaveLength(1);
  });
});

describe("命令面 readSince：三态回执", () => {
  beforeEach(subscribe);

  it("有新数据 ⇒ {ok:true, items, cursor, count, lost}", async () => {
    emitData("COM3", "OK");
    emitData("COM3", "PID=12.5");

    const res = await pull({ since: 0 });

    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
    expect(res.cursor).toBe(2);
    expect(res.lost).toBe(0);
    expect((res.items as Array<Record<string, unknown>>).map((i) => i.text)).toEqual(["OK", "PID=12.5"]);
    expect((res.items as Array<Record<string, unknown>>)[1].hex).toBe("50 49 44 3D 31 32 2E 35");
  });

  it("没有新的 ⇒ {ok:true, noop:true, reason:'no-new-data'}（cursor 原样）", async () => {
    emitData("COM3", "OK");
    await pull({ since: 0 });

    const again = await pull({ since: 1 });

    expect(again).toMatchObject({ ok: true, noop: true, reason: "no-new-data", cursor: 1, items: [] });
  });

  it("续读闭环：cursor → 再拉只回新的（AI 的循环就长这样）", async () => {
    emitData("COM3", "第一组");
    const r1 = await pull({ since: 0 });
    emitData("COM3", "第二组");
    const r2 = await pull({ since: r1.cursor });

    expect((r1.items as Array<Record<string, unknown>>).map((i) => i.text)).toEqual(["第一组"]);
    expect((r2.items as Array<Record<string, unknown>>).map((i) => i.text)).toEqual(["第二组"]);
    expect(r2.lost).toBe(0);
  });

  it("限流：limit 到顶也只给这么多，cursor 指到那一页最后一题", async () => {
    for (let i = 0; i < 10; i++) emitData("COM3", `n${i}`);
    const res = await pull({ since: 0, limit: 3 });
    expect(res.count).toBe(3);
    expect(res.cursor).toBe(3);
  });

  it("落后 ⇒ lost 如实（先说丢了几条，再给还在的）", async () => {
    for (let i = 1; i <= RECEIVE_LOG_MAX + 7; i++) emitData("COM3", `l${i}`);
    const res = await pull({ since: 0, limit: 5 });
    expect(res.lost).toBe(7);
    expect((res.items as Array<Record<string, unknown>>)[0].text).toBe("l8");
  });

  it("游标超过水位 ⇒ cursor-ahead（池页面重载后序号从头再来，如实说并给可用游标）", async () => {
    emitData("COM3", "OK");

    const res = await pull({ since: 99 });

    expect(res).toMatchObject({ ok: false, noop: true, reason: "cursor-ahead", cursor: 1 });
    expect(String(res.error)).toContain("水位");
  });

  it("坏参在**载荷里**出声，⛔ 不抛（AI 参数写错不该变成用户脸上的红 toast）", async () => {
    const badSince = await pull({ since: "5" });
    const badFrac = await pull({ since: 1.5 });
    const badNeg = await pull({ since: -1 });
    const badLimitLow = await pull({ since: 0, limit: 0 });
    const badLimitHigh = await pull({ since: 0, limit: 1001 });
    const badPort = await pull({ since: 0, portName: "   " });

    expect(badSince).toMatchObject({ ok: false, noop: true, reason: "bad-since" });
    expect(badFrac).toMatchObject({ ok: false, noop: true, reason: "bad-since" });
    expect(badNeg).toMatchObject({ ok: false, noop: true, reason: "bad-since" });
    expect(badLimitLow).toMatchObject({ ok: false, noop: true, reason: "bad-limit" });
    expect(badLimitHigh).toMatchObject({ ok: false, noop: true, reason: "bad-limit" });
    expect(badPort).toMatchObject({ ok: false, noop: true, reason: "bad-port" });
    expect(String(badSince.error)).toContain("since");
    // 坏参一次都没读到东西、也没推进游标（日志原样）
    expect(_receiveLog.seq).toBe(0);
  });

  it("两形入参等价：逐位 (since, limit, portName) ＝ 单具名对象", async () => {
    emitData("COM5", "他口");
    emitData("COM3", "本口-1");
    emitData("COM3", "本口-2");

    const named = await pull({ since: 0, limit: 1, portName: "COM3" });
    const positional = await pull(0, 1, "COM3");

    expect(named).toEqual(positional);
    expect(named.count).toBe(1);
  });

  it("缺省 limit = 缺省值（不是「全给」也不是 0）", async () => {
    for (let i = 0; i < 5; i++) emitData("COM3", `n${i}`);
    const res = await pull({ since: 0 });
    expect(res.count).toBe(5);
    expect(RECEIVE_READ_LIMIT_DEFAULT).toBeGreaterThan(5); // 缺省比这批大——故全给
  });

  it("订阅没挂上 ⇒ no-serial-face（如实说读不到，⛔ 不给假空数据）", async () => {
    _receiveLog.subscribed = false;
    writeReceiveLog("COM3", "写得进去但没人收");
    const res = await pull({ since: 0 });
    expect(res).toMatchObject({ ok: false, noop: true, reason: "no-serial-face" });
  });
});

describe("命令面 receiveStatus：水位读数", () => {
  beforeEach(subscribe);

  it("水位 ＋ 每口计数 ＋ 口开态（主进程真源）＋ 开了但没数据的口也列出", async () => {
    statusReply = [{ portName: "COM3" }, { portName: "COM9" }];
    writeReceiveLog("COM3", "OK");

    const res = await status();

    expect(res).toMatchObject({ ok: true, cursor: 1, first: 1, count: 1, capacity: RECEIVE_LOG_MAX });
    const ports = res.ports as Array<Record<string, unknown>>;
    expect(ports).toContainEqual({ portName: "COM3", count: 1, open: true });
    // 开着但一条都没收到——AI 才能分辨「口没开」与「开了但设备没说话」
    expect(ports).toContainEqual({ portName: "COM9", count: 0, open: true });
  });

  it("主进程说话了但口是关的 ⇒ open:false（⛔ 不拿本地集合顶替真源）", async () => {
    statusReply = [];
    setOpenPort("COM3", { baudRate: 115200, txBytes: 0, rxBytes: 0 }); // 本地还以为开着（reload 后的典型脏态）
    writeReceiveLog("COM3", "旧数据");

    const res = await status();
    const ports = res.ports as Array<Record<string, unknown>>;
    expect(ports).toContainEqual({ portName: "COM3", count: 1, open: false });
  });

  it("拉不到主进程口态（无该 API）⇒ 退回本地集合（保底，不是唯一真相）", async () => {
    statusReply = null;
    setOpenPort("COM3", { baudRate: 115200, txBytes: 0, rxBytes: 0 });

    const res = await status();
    const ports = res.ports as Array<Record<string, unknown>>;
    expect(ports).toContainEqual({ portName: "COM3", count: 0, open: true });
  });

  it("订阅没挂上 ⇒ no-serial-face", async () => {
    _receiveLog.subscribed = false;
    expect(await status()).toMatchObject({ ok: false, noop: true, reason: "no-serial-face" });
  });
});
