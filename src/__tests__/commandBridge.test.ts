/**
 * commandBridge——命令路由（E2b #11：按活跃 session ID 分发，消灭「最后一个 mount 的视图接所有命令」）。
 * 判据：`_cmdMap` 单 key 单值（重注册即顶替）/ 按活跃 session 命中 / 未注册与无活跃都返回 null 不炸。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getActiveCmd, _cmdMap, type ActiveCmd } from "../services/commandBridge";
import { _store } from "../hooks/useSerialSessions/store";

/** 造假 ActiveCmd——setter 一律 vi.fn() 填 */
function makeCmd(patch: Partial<ActiveCmd> = {}): ActiveCmd {
  return {
    cmView: { current: null },
    paused: false,
    quickSends: { PING: "PING\r" },
    sendMode: "text",
    showEcho: true,
    showLineNumbers: true,
    separateSystemLog: true,
    autoRepeat: false,
    autoClear: false,
    setPaused: vi.fn(),
    setSendValue: vi.fn(),
    setSendMode: vi.fn(),
    setShowEcho: vi.fn(),
    setShowLineNumbers: vi.fn(),
    setSeparateSystemLog: vi.fn(),
    setAutoRepeat: vi.fn(),
    setAutoClear: vi.fn(),
    setQsEditing: vi.fn(),
    setQsName: vi.fn(),
    setQsContent: vi.fn(),
    setQsAdding: vi.fn(),
    handleDeleteQuickSend: vi.fn(),
    ...patch,
  };
}

describe("getActiveCmd", () => {
  beforeEach(() => {
    _cmdMap.clear();
    _store.sessions = [];
    _store.activeSessionId = null;
  });

  it("活跃会话已注册 → 返回该会话的命令上下文", () => {
    const cmdA = makeCmd();
    _store.activeSessionId = "s-a";
    _cmdMap.set("s-a", cmdA);

    expect(getActiveCmd()).toBe(cmdA);
  });

  it("多会话同时注册：只认活跃那一个（不是最后 mount 的那个）", () => {
    const cmdA = makeCmd();
    const cmdB = makeCmd();
    _cmdMap.set("s-a", cmdA);
    _cmdMap.set("s-b", cmdB);

    _store.activeSessionId = "s-a";
    expect(getActiveCmd()).toBe(cmdA);

    _store.activeSessionId = "s-b";
    expect(getActiveCmd()).toBe(cmdB);
  });

  it("活跃会话没注册过 → null（命令 handler 空跑，不该炸）", () => {
    _cmdMap.set("s-a", makeCmd());
    _store.activeSessionId = "s-unregistered";

    expect(getActiveCmd()).toBeNull();
  });

  it("无活跃会话（null）→ null，且不去查 map", () => {
    _cmdMap.set("s-a", makeCmd());
    _store.activeSessionId = null;

    expect(getActiveCmd()).toBeNull();
  });

  it("注销（unmount）后再派发不炸、返回 null", () => {
    const cmdA = makeCmd();
    _store.activeSessionId = "s-a";
    _cmdMap.set("s-a", cmdA);
    expect(getActiveCmd()).toBe(cmdA);

    _cmdMap.delete("s-a");

    expect(() => getActiveCmd()).not.toThrow();
    expect(getActiveCmd()).toBeNull();
  });

  it("同一 session 重注册 → 顶替（单 key 单值，旧上下文不再被命令命中）", () => {
    const first = makeCmd();
    const second = makeCmd();
    _store.activeSessionId = "s-a";
    _cmdMap.set("s-a", first);
    _cmdMap.set("s-a", second);

    expect(_cmdMap.size).toBe(1);
    expect(getActiveCmd()).toBe(second);
  });

  it("返回的是命令上下文本体（命令 handler 直接调它的 setter——不是副本）", () => {
    const cmdA = makeCmd();
    _store.activeSessionId = "s-a";
    _cmdMap.set("s-a", cmdA);

    getActiveCmd()!.setPaused(true);

    expect(cmdA.setPaused).toHaveBeenCalledWith(true);
  });
});

describe("_cmdMap（模块级单一属主）", () => {
  beforeEach(() => { _cmdMap.clear(); });

  it("空表时按任意 id 取都是 undefined", () => {
    expect(_cmdMap.get("s-a")).toBeUndefined();
    expect(_cmdMap.size).toBe(0);
  });
});
