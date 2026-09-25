/**
 * getters（useSerialSessions）——模块级 getter：非 React 环境（命令 handler / beforeClose）的唯一读入口。
 * 判据：命中与未命中 / 只改匹配那条 / 每次写入都通知订阅者（否则 React 侧不重渲染）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getActiveSessionId, setActiveSessionId, getSessionById, updateSessionById,
} from "../hooks/useSerialSessions/getters";
import { _sessionListeners, _store } from "../hooks/useSerialSessions/store";
import { cloneDefaults, SESSION_COLORS } from "../hooks/useSerialSessions/types";
import type { SerialSession } from "../hooks/useSerialSessions";

function makeSession(id: string, name: string): SerialSession {
  return { id, name, color: SESSION_COLORS[0], ...cloneDefaults() };
}

describe("useSerialSessions/getters", () => {
  beforeEach(() => {
    // 模块级状态——每例前重置（getters 与 store 共用同一份 _store）
    _store.sessions = [];
    _store.activeSessionId = null;
    _store.sessionCounter = 0;
    _store.colorIndex = 0;
    _sessionListeners.clear();
  });

  it("未设置时 getActiveSessionId 返回 null", () => {
    expect(getActiveSessionId()).toBeNull();
  });

  it("setActiveSessionId 写入并通知订阅者", () => {
    const listener = vi.fn();
    _sessionListeners.add(listener);

    setActiveSessionId("s-1");

    expect(getActiveSessionId()).toBe("s-1");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("setActiveSessionId(null) 也通知（清空活跃态同样要触发重渲染）", () => {
    setActiveSessionId("s-1");
    const listener = vi.fn();
    _sessionListeners.add(listener);

    setActiveSessionId(null);

    expect(getActiveSessionId()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("getSessionById 命中返回该会话，未命中返回 undefined", () => {
    _store.sessions = [makeSession("s-1", "A"), makeSession("s-2", "B")];

    expect(getSessionById("s-2")?.name).toBe("B");
    expect(getSessionById("s-nope")).toBeUndefined();
  });

  it("updateSessionById 只改匹配的那条——另一条字段一点不动", () => {
    _store.sessions = [makeSession("s-1", "A"), makeSession("s-2", "B")];

    updateSessionById("s-1", { name: "改名", baudRate: "9600" });

    expect(getSessionById("s-1")).toMatchObject({ name: "改名", baudRate: "9600" });
    expect(getSessionById("s-2")).toEqual(makeSession("s-2", "B"));
  });

  it("updateSessionById 是浅合并——没点到 patch 的字段保持原值", () => {
    _store.sessions = [makeSession("s-1", "A")];

    updateSessionById("s-1", { showEcho: false });

    expect(getSessionById("s-1")).toMatchObject({ name: "A", showEcho: false, baudRate: "115200" });
  });

  it("updateSessionById 未命中：不抛错、不改任何会话（命令 handler 打空 id 不该炸）", () => {
    _store.sessions = [makeSession("s-1", "A")];

    expect(() => updateSessionById("s-nope", { name: "改名" })).not.toThrow();
    expect(_store.sessions).toHaveLength(1);
    expect(getSessionById("s-1")?.name).toBe("A");
  });

  it("updateSessionById 命中时通知订阅者", () => {
    _store.sessions = [makeSession("s-1", "A")];
    const listener = vi.fn();
    _sessionListeners.add(listener);

    updateSessionById("s-1", { name: "改名" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("getter 读的是模块级最新值——不经 React 也能拿到别处写入的结果", () => {
    _store.sessions = [makeSession("s-1", "A")];
    setActiveSessionId("s-1");

    expect(getActiveSessionId()).toBe("s-1");
    expect(getSessionById(getActiveSessionId()!)?.name).toBe("A");
  });
});
