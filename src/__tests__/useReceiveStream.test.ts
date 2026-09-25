/**
 * @vitest-environment jsdom
 * useReceiveStream——接收数据流消费侧（替身层）。
 * 判据：IPC 回调**当场**写环 → rAF 消费循环 → renderLine；端口键控过滤；暂停缓冲（上界 + 丢弃告警 + 恢复补回）；
 *       过滤三态（模式/关键字，system 不过滤）；卸载即停摆；serial-system 的 已打开/关闭 两条分支。
 *
 * 替身来源（本文件三处，⛔ 都不动共享 mock——见 vitest.setup.ts 的一行指针）：
 *   1. `window.linkdesk.serial.onData/onSystem`——共享 mock 里没有 serial 域 ⇒ `vi.fn()` **接管回调**
 *      （共享 mock 只提供 events/filesystem 等六个通用命名空间，serial 是插件专属后门）；
 *   2. `window.linkdesk.events.emit`——换成本文件的 spy（共享 mock 的 emit 是空函数，断言不了广播）；
 *   3. `react-i18next` 整体工厂替身——`t` 用**假函数**（带 count 时插值），⛔ 不引真字典。
 *
 * 定时：`vi.useFakeTimers({ now })` ＋ `advanceTimersByTime()`（rAF 由假时钟驱动）；每例后 `useRealTimers()`。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReceiveStream } from "../views/SerialMonitorView/useReceiveStream";
import { readSettings } from "../views/SerialMonitorView/settings";
import { RingBuffer } from "../utils/RingBuffer";
import { PAUSED_BUFFER_MAX, RING_BUFFER_CAPACITY } from "../constants";
import type { ReceiveItem } from "../types";
import type { SerialSession } from "../hooks/useSerialSessions/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts && typeof opts.count === "number" ? `${key}::${opts.count}` : key,
  }),
}));

type Cb = (payload: unknown) => void;
let dataCb: Cb | undefined;
let systemCb: Cb | undefined;
let emitSpy: ReturnType<typeof vi.fn>;

/** serial 后门桩——三个通道各自把回调交出来（共享 mock 里没有 serial 域） */
function stubSerial() {
  dataCb = undefined;
  systemCb = undefined;
  const serial = {
    onData: vi.fn((cb: Cb) => { dataCb = cb; return () => { dataCb = undefined; }; }),
    onSystem: vi.fn((cb: Cb) => { systemCb = cb; return () => { systemCb = undefined; }; }),
    getStatus: vi.fn(() => Promise.resolve({ portName: "COM_TEST_1", baudRate: 115200 })),
    sendText: vi.fn(() => Promise.resolve()),
    sendData: vi.fn(() => Promise.resolve()),
  };
  (window.linkdesk as unknown as { serial: unknown }).serial = serial;
  return serial;
}

/** 视图设置——用生产自己的 `readSettings` 兜默认值，避免与生产默认值手抄两份 */
function settings(patch: Partial<SerialSession> = {}) {
  return readSettings({ port: "COM_TEST_1", ...patch } as unknown as SerialSession);
}

type Opts = Parameters<typeof useReceiveStream>[0];

function setup(patch: Partial<Opts> = {}) {
  stubSerial();
  const ringRef = { current: new RingBuffer<ReceiveItem>(RING_BUFFER_CAPACITY) };
  const renderLine = vi.fn();
  const appendLine = vi.fn();
  const opts: Opts = {
    sourceId: "s-demo",
    settings: settings({ timestampFormat: "无" }),
    renderLine,
    appendLine,
    ringBuffer: ringRef,
    performSend: vi.fn(() => Promise.resolve()),
    saveReceiveToFile: vi.fn(),
    ...patch,
  };
  const { result, unmount } = renderHook(() => useReceiveStream(opts));
  return { opts, ringRef, renderLine, appendLine, result, unmount };
}

/** 喂一条 IPC 事件（走真实订阅回调，不是直接写环） */
const feed = (payload: unknown) => act(() => { dataCb?.(payload); });
const feedSys = (payload: unknown) => act(() => { systemCb?.(payload); });
/** 推进假时钟 ⇒ 触发一帧 rAF 消费 */
const frame = () => act(() => { vi.advanceTimersByTime(20); });

beforeEach(() => {
  // ⚠️ 必须 `useFakeTimers({ now })` **一次给全**：`useFakeTimers()` 之后再 `setSystemTime()`
  //    会把 rAF 的到期时刻算在旧时钟基上 ⇒ `advanceTimersByTime()` 永远追不到（实测 fired=0）。
  vi.useFakeTimers({ now: new Date(2026, 0, 2, 3, 4, 5, 6) });
  emitSpy = vi.fn();
  const lk = window.linkdesk as unknown as { events: unknown };
  lk.events = { on: () => () => {}, emit: emitSpy };
});

afterEach(() => {
  vi.useRealTimers();
  delete (window.linkdesk as unknown as { serial?: unknown }).serial;
});

describe("IPC 数据 → RingBuffer → rAF → renderLine", () => {
  it("本口数据：回调当场写环（不等 rAF），一帧后交给 renderLine（ASCII + HEX 双形态一次算好）", () => {
    const { renderLine, ringRef } = setup();

    feed({ portName: "COM_TEST_1", text: "hello" });
    expect(ringRef.current.size).toBe(1); // 写环是同步的——rAF 只是消费侧

    frame();

    expect(renderLine).toHaveBeenCalledWith({ text: "hello", hex: "68 65 6C 6C 6F", type: "received" });
    expect(ringRef.current.size).toBe(0); // drainAll 清空
  });

  it("时间戳格式非\"无\" ⇒ 正文与 HEX 两形态都带同一条前缀", () => {
    const { renderLine } = setup({ settings: settings({ timestampFormat: "HH:mm:ss" }) });

    feed({ portName: "COM_TEST_1", text: "hi" });
    frame();

    expect(renderLine).toHaveBeenCalledWith({ text: "03:04:05 -> hi", hex: "03:04:05 -> 68 69", type: "received" });
  });

  it("他口数据被滤掉——连环都进不去（多口并发下各收各的）", () => {
    const { renderLine, ringRef } = setup({ settings: settings({ port: "COM_TEST_1" }) });

    feed({ portName: "COM_TEST_9", text: "别人的数据" });
    frame();

    expect(ringRef.current.size).toBe(0);
    expect(renderLine).not.toHaveBeenCalled();
  });

  it("本会话没配端口 ⇒ 有路由键的数据一律滤（不允许「没配就全收」）", () => {
    const { renderLine, ringRef } = setup({ settings: settings({ port: "" }) });

    feed({ portName: "COM_TEST_1", text: "有键" });
    expect(ringRef.current.size).toBe(0);

    feed({ text: "无键" }); // 无键走三态兜底 ⇒ 收
    frame();

    expect(renderLine).toHaveBeenCalledTimes(1);
    // 默认时间戳格式开着 ⇒ 正文带 `HH:mm:ss:fff -> ` 前缀，断言只看尾部载荷
    expect(renderLine.mock.calls[0][0].text.endsWith("无键")).toBe(true);
    expect(renderLine.mock.calls[0][0].type).toBe("received");
  });

  it("无 sourceId（per-tab 未绑定）⇒ 任何数据都不收（防串会话）", () => {
    const { renderLine, ringRef } = setup({ sourceId: undefined });

    feed({ portName: "COM_TEST_1", text: "hello" });
    frame();

    expect(ringRef.current.size).toBe(0);
    expect(renderLine).not.toHaveBeenCalled();
  });

  it("空 / 纯空白文本跳过（不往接收区写空气行），同帧的下一行照常渲染", () => {
    const { renderLine } = setup();

    feed({ portName: "COM_TEST_1", text: "   " });
    feed({ portName: "COM_TEST_1", text: "ok" });
    frame();

    expect(renderLine).toHaveBeenCalledTimes(1);
    expect(renderLine.mock.calls[0][0]).toMatchObject({ text: "ok" });
  });

  it("卸载 ⇒ rAF 循环停摆（环里再来的数据不会被消费）", () => {
    const { renderLine, ringRef, unmount } = setup();
    feed({ portName: "COM_TEST_1", text: "before" });
    frame();
    expect(renderLine).toHaveBeenCalledTimes(1);

    unmount();
    ringRef.current.write({ text: "after", type: "received" });
    frame();

    expect(renderLine).toHaveBeenCalledTimes(1);
  });
});

describe("暂停 / 继续", () => {
  it("handlePause 进暂停：写一行系统提示，界面冻结（renderLine 不再被调）", () => {
    const { appendLine, renderLine, result } = setup();

    act(() => { result.current.handlePause(); });

    expect(result.current.paused).toBe(true);
    expect(appendLine).toHaveBeenCalledWith("---- 暂停显示：界面已冻结，后台照常接收 ----", "system");

    feed({ portName: "COM_TEST_1", text: "a" });
    feed({ portName: "COM_TEST_1", text: "b" });
    frame();

    expect(renderLine).not.toHaveBeenCalled();
    expect(result.current.pausedCount).toBe(2);
  });

  it("继续：缓冲**按序补回**渲染 + 报条数，pausedCount 归零", () => {
    const { appendLine, renderLine, result } = setup();
    act(() => { result.current.handlePause(); });
    feed({ portName: "COM_TEST_1", text: "a" });
    feed({ portName: "COM_TEST_1", text: "b" });
    frame();

    act(() => { result.current.handlePause(); });

    expect(result.current.paused).toBe(false);
    expect(renderLine.mock.calls.map((c) => (c[0] as ReceiveItem).text)).toEqual(["a", "b"]);
    expect(result.current.pausedCount).toBe(0);
    expect(appendLine).toHaveBeenLastCalledWith("---- 继续显示：补回暂停期间的 {{count}} 条数据 ----::2", "system");
  });

  it("暂停期间一条都没来 ⇒ 继续时走无条数的那句（不报 0 条）", () => {
    const { appendLine, renderLine, result } = setup();
    act(() => { result.current.handlePause(); });

    act(() => { result.current.handlePause(); });

    expect(renderLine).not.toHaveBeenCalled();
    expect(appendLine).toHaveBeenLastCalledWith("---- 继续显示 ----", "system");
  });

  it("缓冲上界 PAUSED_BUFFER_MAX：满了丢最老的、只告警一次（丢了数据必须让用户看见）", () => {
    const ring = new RingBuffer<ReceiveItem>(PAUSED_BUFFER_MAX + 10);
    // 直接灌环（等价于「暂停期间来了 2001 条」）——比走 2001 次 IPC 回调更能隔离本判据
    for (let i = 0; i <= PAUSED_BUFFER_MAX; i++) ring.write({ text: `m${i}`, type: "received" });
    const big = setup({ ringBuffer: { current: ring } });
    act(() => { big.result.current.handlePause(); });

    frame();

    expect(big.result.current.pausedCount).toBe(PAUSED_BUFFER_MAX);
    const warn = big.appendLine.mock.calls.filter((c) => String(c[0]).includes("暂停缓冲已满"));
    expect(warn).toHaveLength(1);
    expect(warn[0][1]).toBe("system");

    // 恢复：最老的 m0 已被挤掉，补回的是 m1 起
    act(() => { big.result.current.handlePause(); });
    expect((big.renderLine.mock.calls[0][0] as ReceiveItem).text).toBe("m1");
    expect(big.renderLine).toHaveBeenCalledTimes(PAUSED_BUFFER_MAX);
  });
});

describe("过滤三态（模式 / 关键字）", () => {
  it("protocol 只留带 \"[\" 的行；plain 只留不带 \"[\" 的行", () => {
    const proto = setup();
    act(() => { proto.result.current.setFilterMode("protocol"); });
    feed({ portName: "COM_TEST_1", text: "no bracket" });
    feed({ portName: "COM_TEST_1", text: "[proto] data" });
    frame();
    expect(proto.renderLine.mock.calls.map((c) => (c[0] as ReceiveItem).text)).toEqual(["[proto] data"]);

    const plain = setup();
    act(() => { plain.result.current.setFilterMode("plain"); });
    feed({ portName: "COM_TEST_1", text: "no bracket" });
    feed({ portName: "COM_TEST_1", text: "[proto] data" });
    frame();
    expect(plain.renderLine.mock.calls.map((c) => (c[0] as ReceiveItem).text)).toEqual(["no bracket"]);
  });

  it("关键字过滤不分大小写；清空关键字即恢复全收", () => {
    const { renderLine, result } = setup();
    act(() => { result.current.setFilterKeyword("err"); });

    feed({ portName: "COM_TEST_1", text: "no" });
    feed({ portName: "COM_TEST_1", text: "ERR happened" });
    frame();
    expect(renderLine.mock.calls.map((c) => (c[0] as ReceiveItem).text)).toEqual(["ERR happened"]);

    renderLine.mockClear();
    act(() => { result.current.setFilterKeyword(""); });
    feed({ portName: "COM_TEST_1", text: "no" });
    frame();
    expect(renderLine).toHaveBeenCalledTimes(1);
  });

  it("system 行**不过滤**（系统提示不该被用户的关键字挡掉）", () => {
    const { renderLine, ringRef, result } = setup();
    act(() => { result.current.setFilterMode("protocol"); });
    act(() => { result.current.setFilterKeyword("zzz"); });

    ringRef.current.write({ text: "系统提示：没有方括号也没有关键字", type: "system" });
    frame();

    expect(renderLine).toHaveBeenCalledTimes(1);
    expect((renderLine.mock.calls[0][0] as ReceiveItem).type).toBe("system");
  });
});

describe("serial-system 的两条分支", () => {
  it("\"已打开\" ⇒ 复位暂停态 + 把该口状态广播到大厅 events 频道", async () => {
    const { result } = setup();
    act(() => { result.current.handlePause(); });
    feed({ portName: "COM_TEST_1", text: "a" });
    frame();
    expect(result.current.pausedCount).toBe(1);

    await act(async () => {
      systemCb?.({ portName: "COM_TEST_1", message: "端口 COM_TEST_1 已打开", type: "status" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.paused).toBe(false);
    expect(result.current.pausedCount).toBe(0);
    expect(emitSpy).toHaveBeenCalledWith("serial:connected", { portName: "COM_TEST_1", baudRate: 115200 });
  });

  it("开端口即发初始化序列（sendInitOnOpen）⇒ 按 quickSends 顺序逐条 performSend", async () => {
    const performSend = vi.fn(() => Promise.resolve());
    setup({ settings: settings({ sendInitOnOpen: true, quickSends: { A: "AAA", B: "BBB" } }), performSend });

    await act(async () => {
      systemCb?.({ portName: "COM_TEST_1", message: "端口 COM_TEST_1 已打开", type: "status" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(performSend.mock.calls.map((c) => c[0])).toEqual(["AAA", "BBB"]);
    expect(performSend).toHaveBeenCalledWith("AAA", { ending: "\r\n", prefix: "> " });
  });

  it("\"关闭\" ⇒ 先清空环再落盘再广播断开（顺序即契约：落盘的正是清空前已渲染的数据）", async () => {
    const saveReceiveToFile = vi.fn();
    const { result, ringRef } = setup({ saveReceiveToFile });
    feed({ portName: "COM_TEST_1", text: "待落盘" });
    expect(ringRef.current.size).toBe(1);

    await act(async () => {
      systemCb?.({ portName: "COM_TEST_1", message: "端口 COM_TEST_1 已关闭", type: "status" });
      await Promise.resolve();
    });

    expect(saveReceiveToFile).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith("serial:disconnected", {});
    expect(ringRef.current.size).toBe(1); // 清空后只剩那条系统行
    expect(ringRef.current.drainAll()[0].type).toBe("system");
    expect(result.current.paused).toBe(false);
  });

  it("他口的 status 提示不显示；error 类型是全局的（他口也显示）", () => {
    const { renderLine, ringRef } = setup();

    feedSys({ portName: "COM_TEST_9", message: "端口 COM_TEST_9 已打开", type: "status" });
    expect(ringRef.current.size).toBe(0);

    feedSys({ portName: "COM_TEST_9", message: "驱动错误", type: "error" });
    frame();

    expect(renderLine).toHaveBeenCalledTimes(1);
    expect((renderLine.mock.calls[0][0] as ReceiveItem).type).toBe("system");
  });
});

describe("返回面（工具栏要用的那几个）", () => {
  it("过滤态与暂停态都在返回值里，且 pausedCount 初值 0 / 过滤初值 all+空关键字", () => {
    const { result } = setup();

    expect(result.current.paused).toBe(false);
    expect(result.current.pausedCount).toBe(0);
    expect(result.current.filterMode).toBe("all");
    expect(result.current.filterKeyword).toBe("");
    expect(typeof result.current.handlePause).toBe("function");
  });
});
