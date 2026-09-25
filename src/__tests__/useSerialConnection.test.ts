/**
 * useSerialConnection——侧栏「哪些端口开着」的订阅（E5.8#27 多口集合语义）。
 *
 * ── 替身层样板之二（E6#148）：**接管 `window.linkdesk.events.on` 抓 IPC 回调** ──
 * 共享地基（`@linkdesk/plugin-sdk/vitest-setup`）里 `events.on` 是 no-op，抓不到 handler 引用；
 * 本仓测试自己把它换成 spy——被调用时**把 handler 存进模块级 Map**，测试再手动触发。
 * 后续会话（#149+）要测「壳推事件 → 插件响应」照抄这段。
 * （serial 后门是另一条传输，接管 `serial.onData/onSystem` 的写法见 useReceiveStream.test.ts——
 *   两条传输不同，勿混。）
 *
 * ⛔ 不动共享地基：接管只发生在本文件（局部 `vi.fn()` 替换），别仓测试的运行环境零影响。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSerialConnection } from "../views/SessionListView/useSerialConnection";
import { SERIAL_MONITOR_PLUGIN_ID } from "../utils/pluginId";

type LkTest = { events?: { on?: unknown; emit?: unknown } };
const lkObj = () => window.linkdesk as unknown as LkTest;

/** 被接管的 events.on 捕获下来的 handler——key = 事件名 */
let handlers: Map<string, (payload: unknown) => void>;
let unsub: ReturnType<typeof vi.fn>;
let onSpy: ReturnType<typeof vi.fn>;

/** 手动触发一次 plugin-state:changed（setState 得裹 act） */
function pushState(key: string | undefined, value: unknown, pluginId = SERIAL_MONITOR_PLUGIN_ID) {
  act(() => {
    handlers.get("plugin-state:changed")!({ pluginId, key, value });
  });
}

beforeEach(() => {
  handlers = new Map();
  unsub = vi.fn();
  onSpy = vi.fn((name: string, h: (payload: unknown) => void) => {
    handlers.set(name, h);
    return unsub;
  });
  lkObj().events = { on: onSpy, emit: () => {} };
});

describe("useSerialConnection", () => {
  it("mount 就订 plugin-state:changed——事件名是契约，写错整条侧栏亮灯链就断", () => {
    const { result } = renderHook(() => useSerialConnection());

    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(onSpy.mock.calls[0][0]).toBe("plugin-state:changed");
    expect(typeof onSpy.mock.calls[0][1]).toBe("function");
    expect([...result.current.openPorts]).toEqual([]);
  });

  it("`<口>:isOpen = true` ⇒ 该口进集合（键名的 `:isOpen` 后缀被剥掉）", () => {
    const { result } = renderHook(() => useSerialConnection());

    pushState("COM3:isOpen", true);

    expect([...result.current.openPorts]).toEqual(["COM3"]);
  });

  it("`<口>:isOpen = false` ⇒ 该口出集合（关掉即灭灯）", () => {
    const { result } = renderHook(() => useSerialConnection());

    pushState("COM3:isOpen", true);
    pushState("COM3:isOpen", false);

    expect([...result.current.openPorts]).toEqual([]);
  });

  it("多口各自独立：关一口不动另一口（E5.8#27 集合语义——不是「当前口」单值）", () => {
    const { result } = renderHook(() => useSerialConnection());

    pushState("COM3:isOpen", true);
    pushState("COM5:isOpen", true);
    expect(result.current.openPorts.size).toBe(2);

    pushState("COM3:isOpen", false);
    expect([...result.current.openPorts]).toEqual(["COM5"]);

    // 重复开同一口不重复计（Set 幂等）——多 WebView 各自广播时会出现重复 true
    pushState("COM5:isOpen", true);
    expect(result.current.openPorts.size).toBe(1);
  });

  it("别只插件的 key 一律不理会（总线上所有插件状态都从这里过）", () => {
    const { result } = renderHook(() => useSerialConnection());

    pushState("COM3:isOpen", true, "someone-else");

    expect(result.current.openPorts.size).toBe(0);
  });

  it("非 `:isOpen` 结尾的键、value 不是 boolean 的键，都不理会（同域其它状态字段不亮灯）", () => {
    const { result } = renderHook(() => useSerialConnection());

    pushState("COM3:baudRate", 115200);
    pushState("COM3:isOpen", "yes"); // 字符串 "yes" 不算——严格 typeof boolean
    pushState("COM3:isOpen", 1); // 1/0 也不算
    pushState(undefined, true); // 壳给缺 key 的载荷也不许抛

    expect(result.current.openPorts.size).toBe(0);
  });

  it("退化键名 `:isOpen` ⇒ 端口剥成空串仍入集合（现状口径：`slice(0,-7)` 不做非空校验）", () => {
    const { result } = renderHook(() => useSerialConnection());

    pushState(":isOpen", true);

    expect([...result.current.openPorts]).toEqual([""]);
  });

  it("payload 整个缺失也不抛（`data?.pluginId` 的兜底）", () => {
    const { result } = renderHook(() => useSerialConnection());

    expect(() => act(() => handlers.get("plugin-state:changed")!(undefined))).not.toThrow();
    expect(result.current.openPorts.size).toBe(0);
  });

  it("卸载 ⇒ 退订（侧栏切走后再来的事件不该继续写已卸载组件的 state）", () => {
    const { unmount } = renderHook(() => useSerialConnection());

    unmount();

    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("没有 events 通道（非壳环境 / preload 未注入）⇒ 不抛，集合恒空", () => {
    lkObj().events = undefined;

    const { result, unmount } = renderHook(() => useSerialConnection());

    expect(onSpy).not.toHaveBeenCalled();
    expect(result.current.openPorts.size).toBe(0);
    expect(() => unmount()).not.toThrow();
  });
});
