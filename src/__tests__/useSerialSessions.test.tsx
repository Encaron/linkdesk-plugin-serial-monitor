/**
 * @vitest-environment jsdom
 * useSerialSessions——模块级单例 hook。
 * Phase 5.5c Bug Fix：验证 createSession 对空字符串 ID 的防御处理。
 *
 * E6#148 补例（hook 面缺口）：重复 id / 未知 id / 连续创建-删除 / 色板轮转 / 计数与 per-会话默认值隔离 /
 * useSession 的自动建会话。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSerialSessions, useSession, getActiveSessionId, getSessionById } from "../hooks/useSerialSessions";
import { SESSION_COLORS } from "../hooks/useSerialSessions/types";

describe("useSerialSessions", () => {
  beforeEach(() => {
    // 每个测试前重置模块级状态
    const { result } = renderHook(() => useSerialSessions());
    act(() => { result.current.resetAll(); });
  });

  describe("createSession", () => {
    it("空字符串 id 应自动生成有效 ID——不产生 falsy session.id", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => {
        result.current.createSession("测试", "");
      });

      const session = result.current.activeSession;
      expect(session).not.toBeNull();
      expect(session!.id).toBeTruthy();           // 不是空串
      expect(session!.id).not.toBe("");
      expect(getActiveSessionId()).toBe(session!.id);
      expect(getActiveSessionId()).toBeTruthy();   // getter 也不返回空串
    });

    it("无 id 参数（undefined）应自动生成 ID", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => {
        result.current.createSession("测试");
      });

      const session = result.current.activeSession;
      expect(session).not.toBeNull();
      expect(session!.id).toBeTruthy();
      expect(session!.id).toMatch(/^serial-monitor-\d+$/);
    });

    it("有效 id 应直接使用——不覆盖", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => {
        result.current.createSession("测试", "custom-id-123");
      });

      expect(result.current.activeSession!.id).toBe("custom-id-123");
      expect(getActiveSessionId()).toBe("custom-id-123");
    });

    it("新会话自动设为活跃", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => {
        result.current.createSession("A", "id-A");
      });

      expect(result.current.activeSessionId).toBe("id-A");
      expect(result.current.activeSession!.name).toBe("A");
    });
  });

  describe("removeSession", () => {
    it("删除活跃会话 → 自动切换到剩余第一个", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => { result.current.createSession("A", "a"); });
      act(() => { result.current.createSession("B", "b"); });

      expect(result.current.sessions).toHaveLength(2);
      expect(result.current.activeSessionId).toBe("b");

      act(() => { result.current.removeSession("b"); });

      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.activeSessionId).toBe("a");
    });

    it("删除最后一个会话 → activeSessionId 为 null", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => { result.current.createSession("A", "a"); });
      act(() => { result.current.removeSession("a"); });

      expect(result.current.sessions).toHaveLength(0);
      expect(result.current.activeSessionId).toBeNull();
      expect(result.current.activeSession).toBeNull();
    });
  });

  describe("updateSession", () => {
    it("部分更新会话字段", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => { result.current.createSession("A", "a"); });
      act(() => { result.current.updateSession("a", { name: "改名", baudRate: "9600" }); });

      expect(result.current.activeSession!.name).toBe("改名");
      expect(result.current.activeSession!.baudRate).toBe("9600");
      // 未修改的字段保持默认
      expect(result.current.activeSession!.showEcho).toBe(true);
    });
  });

  describe("resetAll", () => {
    it("清空所有会话和活跃状态", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => { result.current.createSession("A", "a"); });
      act(() => { result.current.createSession("B", "b"); });
      act(() => { result.current.resetAll(); });

      expect(result.current.sessions).toHaveLength(0);
      expect(result.current.activeSessionId).toBeNull();
      expect(result.current.activeSession).toBeNull();
      expect(getActiveSessionId()).toBeNull();
    });
  });

  describe("getActiveSessionId / getSessionById（模块级 getter）", () => {
    it("getActiveSessionId 始终返回最新活跃 ID", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => { result.current.createSession("A", "a"); });
      expect(getActiveSessionId()).toBe("a");

      act(() => { result.current.setActiveSession(null); });
      expect(getActiveSessionId()).toBeNull();
    });

    it("getSessionById 按 ID 查找会话", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => { result.current.createSession("A", "a"); });

      const found = getSessionById("a");
      expect(found).toBeDefined();
      expect(found!.name).toBe("A");
      expect(getSessionById("nonexistent")).toBeUndefined();
    });
  });

  /* ── E6#148 补例：hook 面缺口 ── */

  describe("重复 id / 未知 id", () => {
    it("重复的显式 id ⇒ 两条同 id 会话并存，getter 命中**先建的那条**（现状即契约：调用方不传 id）", () => {
      // ⚠️ 生产路径不可达：useSessionCrud 走 createSession(name) 不传 id、useSession 的 id 是 tab 绑定。
      //    登记在交接段，⛔ 本轮不改生产代码——这里钉住的是「同 id 不做去重」这个现状。
      const { result } = renderHook(() => useSerialSessions());

      act(() => { result.current.createSession("先", "dup"); });
      act(() => { result.current.createSession("后", "dup"); });

      expect(result.current.sessions).toHaveLength(2);
      // 活跃口指向 id ⇒ `activeSession` 是 `find` ⇒ **先建的那条**（同 id 不去重、也不替换引用）
      expect(result.current.activeSession!.name).toBe("先");
      expect(getSessionById("dup")!.name).toBe("先");
    });

    it("setActiveSession 到不存在的 id ⇒ 记录它但 activeSession 为 null（不编造会话）", () => {
      const { result } = renderHook(() => useSerialSessions());
      act(() => { result.current.createSession("A", "a"); });

      act(() => { result.current.setActiveSession("ghost"); });

      expect(result.current.activeSessionId).toBe("ghost");
      expect(result.current.activeSession).toBeNull();
      expect(getActiveSessionId()).toBe("ghost");
    });

    it("updateSession / removeSession 给未知 id ⇒ 不抛、不动别的会话、不动活跃口", () => {
      const { result } = renderHook(() => useSerialSessions());
      act(() => { result.current.createSession("A", "a"); });

      act(() => { result.current.updateSession("ghost", { name: "幽灵" }); });
      act(() => { result.current.removeSession("ghost"); });

      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0].name).toBe("A");
      expect(result.current.activeSessionId).toBe("a");
    });
  });

  describe("连续创建 / 删除与色板轮转", () => {
    it("删非活跃会话 ⇒ 活跃口不动；删活跃 ⇒ 顺位到剩下的第一个", () => {
      const { result } = renderHook(() => useSerialSessions());
      act(() => { result.current.createSession("A", "a"); });
      act(() => { result.current.createSession("B", "b"); });
      act(() => { result.current.createSession("C", "c"); });

      act(() => { result.current.removeSession("a"); });
      expect(result.current.activeSessionId).toBe("c");

      act(() => { result.current.removeSession("c"); });
      expect(result.current.activeSessionId).toBe("b");

      act(() => { result.current.removeSession("b"); });
      expect(result.current.activeSessionId).toBeNull();
    });

    it("色板轮转：第 N 个会话取 SESSION_COLORS[N % 长度]，转满一圈回头", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => {
        for (let i = 0; i < SESSION_COLORS.length + 1; i++) result.current.createSession(`S${i}`);
      });

      const colors = result.current.sessions.map((s) => s.color);
      expect(colors.slice(0, SESSION_COLORS.length)).toEqual(SESSION_COLORS);
      expect(colors[SESSION_COLORS.length]).toBe(SESSION_COLORS[0]);
    });

    it("计数只给**自动 id** 涨：显式 id 不占号（换口后自动 id 仍从 1 起）", () => {
      const { result } = renderHook(() => useSerialSessions());

      act(() => { result.current.createSession("A", "custom-1"); });
      act(() => { result.current.createSession("B", "custom-2"); });
      act(() => { result.current.createSession("C"); });

      expect(result.current.sessions.map((s) => s.id)).toEqual(["custom-1", "custom-2", "serial-monitor-1"]);
    });

    it("resetAll 连计数与色板一起归零（不是只清列表）", () => {
      const { result } = renderHook(() => useSerialSessions());
      act(() => { result.current.createSession("A"); });

      act(() => { result.current.resetAll(); });
      act(() => { result.current.createSession("B"); });

      expect(result.current.sessions[0].id).toBe("serial-monitor-1");
      expect(result.current.sessions[0].color).toBe(SESSION_COLORS[0]);
    });
  });

  describe("per-会话 默认值隔离", () => {
    it("两个会话的 quickSends 不是同一个对象（改一个不许串到另一个）", () => {
      const { result } = renderHook(() => useSerialSessions());
      act(() => { result.current.createSession("A", "a"); });
      act(() => { result.current.createSession("B", "b"); });

      const [a, b] = result.current.sessions;
      expect(a.quickSends).not.toBe(b.quickSends);

      act(() => { result.current.updateSession("a", { port: "COM_TEST_1" }); });

      expect(getSessionById("a")!.port).toBe("COM_TEST_1");
      expect(getSessionById("b")!.port).toBe("");
    });

    it("updateSession 是**浅合并**：给的键整份替换（quickSends 不做深合并）", () => {
      const { result } = renderHook(() => useSerialSessions());
      act(() => { result.current.createSession("A", "a"); });
      const before = getSessionById("a")!.quickSends;
      expect(Object.keys(before).length).toBeGreaterThan(0); // 生产默认确实预置了快捷发送

      act(() => { result.current.updateSession("a", { quickSends: { PING: "PING" } }); });

      expect(getSessionById("a")!.quickSends).toEqual({ PING: "PING" });
    });
  });
});

describe("useSession（per-tab 会话）", () => {
  beforeEach(() => {
    const { result } = renderHook(() => useSerialSessions());
    act(() => { result.current.resetAll(); });
  });

  it("id 指向的会话不存在 ⇒ 自动建一条（tab 恢复时数据不丢）", () => {
    const { result } = renderHook(({ id }: { id: string }) => useSession(id), { initialProps: { id: "tab-1" } });

    expect(result.current.session).not.toBeNull();
    expect(result.current.session!.id).toBe("tab-1");
    expect(getSessionById("tab-1")).toBeDefined();
  });

  it("重渲染 / id 不变 ⇒ 不重复建（didAutoCreate 只放行一次）", () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useSession(id), { initialProps: { id: "tab-1" } });

    rerender({ id: "tab-1" });
    rerender({ id: "tab-1" });

    expect(result.current.session!.id).toBe("tab-1");
    const { result: list } = renderHook(() => useSerialSessions());
    expect(list.current.sessions.filter((s) => s.id === "tab-1")).toHaveLength(1);
  });

  it("id 为 undefined ⇒ 不建会话、session 为 null、update 是安全空操作", () => {
    const { result } = renderHook(({ id }: { id: string | undefined }) => useSession(id), { initialProps: { id: undefined } });

    expect(result.current.session).toBeNull();
    expect(() => act(() => { result.current.update({ name: "改不动" }); })).not.toThrow();

    const { result: list } = renderHook(() => useSerialSessions());
    expect(list.current.sessions).toHaveLength(0);
  });

  it("update 只动本 tab 那条会话", () => {
    const { result } = renderHook(({ id }: { id: string }) => useSession(id), { initialProps: { id: "tab-1" } });
    const { result: other } = renderHook(({ id }: { id: string }) => useSession(id), { initialProps: { id: "tab-2" } });

    act(() => { result.current.update({ baudRate: "9600" }); });

    expect(result.current.session!.baudRate).toBe("9600");
    expect(other.current.session!.baudRate).toBe("115200");
  });
});
