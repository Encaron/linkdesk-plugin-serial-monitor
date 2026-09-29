/**
 * @vitest-environment jsdom
 * `useToggleCommands`——本插件唯一一条「必须视图在场」的开关（`togglePause`）＋ 它注册进去的**标题**。
 *
 * 判据两条：
 *   ① **标题恒为动作名**（`AI#68`）：从前的标题按「现在暂停没」在「暂停接收／继续接收」之间翻，
 *      而标题槽是**全局一个**、`paused` 是**每条视图各自的** ⇒ 多标签页下必撒谎。现在恒为
 *      「切换接收暂停」，且本 hook 收不到任何状态参数（结构性保证：想按态写也没得写）。
 *   ② 三条路径如实回：点名了没挂视图的会话 ⇒ `no-view` 坏回执（⛔ 不是 null 解引用炸栈）；点名不存在
 *      的会话 ⇒ `bad-session` ＋ 现有清单；目标挂着视图 ⇒ 返回 `field:"paused"` 与翻转后的值。
 *
 * 替身来源：`window.linkdesk.commands` / `pluginState` 共享地基里没有（插件专属）⇒ 本文件就地铺。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { useToggleCommands } from "../views/SerialMonitorView/useToggleCommands";
import { createSessionModule } from "../hooks/useSerialSessions";
import { _cmdMap, type ActiveCmd } from "../services/commandBridge";
import { _sessionListeners, _store } from "../hooks/useSerialSessions/store";

type Meta = { title?: string; category?: string };
const metas = new Map<string, Meta>();
let handlers: Map<string, (...a: unknown[]) => unknown>;

beforeAll(async () => {
  // ⚠️ i18next 在本仓测试里默认未初始化（`t()` 给 undefined ⇒ 拿 undefined 比 undefined 是空过）。
  //    空词典初始化一次并把实例接给 react-i18next：`t(键)` 原样回键，标题就是词条原文
  //    —— hook 里那句 `t("切换接收暂停")` 走的是**真 i18next**，不是 react-i18next 的兜底 `t`。
  await i18n.use(initReactI18next).init({
    lng: "zh", resources: { zh: { translation: {} } }, initImmediate: false,
  });
});

beforeEach(() => {
  handlers = new Map();
  metas.clear();
  (window.linkdesk as unknown as Record<string, unknown>).commands = {
    registerCommand: (id: string, h: (...a: unknown[]) => unknown, meta?: Meta) => {
      handlers.set(id, h);
      if (meta) metas.set(id, meta);
    },
    unregisterCommands: vi.fn(),
  };
  (window.linkdesk as unknown as Record<string, unknown>).pluginState = {
    set: () => Promise.resolve(),
  };
  _store.sessions = [];
  _store.activeSessionId = null;
  _sessionListeners.clear();
  _cmdMap.clear();
});

describe("AI#68 togglePause：标题与三条回执路", () => {
  it("🔴 标题恒为「切换接收暂停」（含 category），且不随任何状态变——hook 压根收不到状态参数", () => {
    const { rerender } = renderHook(() => useToggleCommands());

    expect(metas.get("serial-monitor.togglePause")).toMatchObject({
      title: "切换接收暂停",
      category: "串口监视器",
    });
    expect(metas.get("serial-monitor.togglePause")?.title).not.toMatch(/继续/); // ⛔ 不再是二选一

    rerender();
    expect(metas.get("serial-monitor.togglePause")?.title).toBe("切换接收暂停");
  });

  it("目标会话没挂视图 ⇒ no-view 坏回执（暂停是视图态，⛔ 不 null 解引用炸栈）", async () => {
    renderHook(() => useToggleCommands());
    const s = createSessionModule("会话1", "s-1");

    const res = await handlers.get("serial-monitor.togglePause")!({ sessionId: s.id }) as {
      ok: boolean; noop: boolean; reason: string; error: string;
    };

    expect(res).toMatchObject({ ok: false, noop: true, reason: "no-view" });
    expect(res.error).toMatch(/没有挂载标签页/);
  });

  it("点名不存在的会话 ⇒ bad-session ＋ 现有清单（门外能自己纠正）", async () => {
    renderHook(() => useToggleCommands());
    createSessionModule("会话1", "s-1");

    const res = await handlers.get("serial-monitor.togglePause")!({ sessionId: "s-nope" }) as {
      ok: boolean; reason: string; error: string;
    };

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("bad-session");
    expect(res.error).toMatch(/会话1\[s-1\]/);
  });

  it("目标挂着视图 ⇒ 返回 field 恒为 paused ＋ 翻转后的值／previous（视图态无存储层，如实说「刚下的那一脚」）", async () => {
    renderHook(() => useToggleCommands());
    const s = createSessionModule("会话1", "s-1");
    const setPaused = vi.fn((fn: (p: boolean) => boolean) => { void fn(false); });
    _cmdMap.set(s.id, { paused: false, cmView: { current: null }, setPaused } as unknown as ActiveCmd);

    const res = await handlers.get("serial-monitor.togglePause")!({ sessionId: s.id }) as {
      ok: boolean; sessionId: string; name: string; field: string; value: boolean; previous: boolean;
    };

    expect(res).toMatchObject({
      ok: true, sessionId: s.id, name: "会话1", field: "paused", value: true, previous: false,
    });
    expect(setPaused).toHaveBeenCalledTimes(1);
  });
});
