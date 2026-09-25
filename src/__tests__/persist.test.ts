/**
 * persist——会话快照恢复（替身层）。
 * 判据：同步恢复（localStorage 立即填充，mount 首帧就有数据）/ 异步权威覆盖（pluginState 赢）/ 幂等（`_initDone` 守卫）/
 *       跨 WebView 广播应用 + **自回环跳过**（自己 emit 的广播回来不能再应用一次）。
 *
 * ⚠️ 本文件**必须**用 `vi.resetModules()` ＋ 动态 `import()`：`_initDone` 是 persist.ts 的模块私有 let，
 *    导不出来也改不了——只有换一张模块图才能给每个 case 一个干净的「首次 mount」。
 *    ⛔ 本文件不碰 React（`resetModules` ＋ `renderHook` 会得到两份 React ⇒ invalid hook call）。
 *
 * 替身来源：`pluginState` / `events.on` 共享 mock 里没有真语义（on 是 no-op）⇒ 就地 `vi.fn()` 接管。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as StoreNS from "../hooks/useSerialSessions/store";

type OnCb = (data: Record<string, unknown>) => void;

let onSpy: ReturnType<typeof vi.fn>;
let handlers: Map<string, OnCb>;
let psGet: ReturnType<typeof vi.fn>;

const flush = () => new Promise((r) => setTimeout(r, 0));

/** 取一套**全新**的模块图（store ＋ persist 同源，不能混用旧图里的 _store） */
async function boot(): Promise<typeof StoreNS> {
  vi.resetModules();
  const store = (await import("../hooks/useSerialSessions/store")) as typeof StoreNS;
  const persist = await import("../hooks/useSerialSessions/persist");
  persist._ensureInit();
  return store;
}

/** 只 import 不初始化（给「自己控制 init 时机」的 case 用） */
async function bootLazy() {
  vi.resetModules();
  const store = (await import("../hooks/useSerialSessions/store")) as typeof StoreNS;
  const persist = await import("../hooks/useSerialSessions/persist");
  return { store, persist };
}

function seedLocal(sessions: { id: string; name: string }[]) {
  localStorage.setItem("linkdesk:serial-monitor:sessions", JSON.stringify({ sessions, activeSessionId: sessions[0]?.id ?? null, sessionCounter: sessions.length, colorIndex: 0 }));
}

beforeEach(() => {
  localStorage.clear();
  handlers = new Map();
  onSpy = vi.fn((ch: string, cb: OnCb) => { handlers.set(ch, cb); return () => handlers.delete(ch); });
  psGet = vi.fn(() => Promise.resolve(undefined));
  const lk = window.linkdesk as unknown as { events: unknown; pluginState?: unknown };
  lk.events = { on: onSpy, emit: vi.fn() };
  lk.pluginState = { get: psGet, set: vi.fn(() => Promise.resolve()) };
});

afterEach(() => {
  delete (window.linkdesk as unknown as { pluginState?: unknown }).pluginState;
  vi.restoreAllMocks();
});

describe("_ensureInit · 同步恢复", () => {
  it("localStorage 有数据 ⇒ 返回前 store 已填充（mount 首帧就能画，不用等异步）", async () => {
    seedLocal([{ id: "s-a", name: "A" }]);

    const store = await boot();

    expect(store._store.sessions.map((s) => s.id)).toEqual(["s-a"]);
    expect(store._store.activeSessionId).toBe("s-a");
  });

  it("localStorage 空 ⇒ 保持空表（不编造会话）", async () => {
    const store = await boot();

    expect(store._store.sessions).toEqual([]);
    expect(store._store.activeSessionId).toBeNull();
  });

  it("幂等：多次调用只做一次初始化（on 只注册一次、只查一次 pluginState）", async () => {
    const { store, persist } = await bootLazy();

    persist._ensureInit();
    persist._ensureInit();
    persist._ensureInit();
    await flush();

    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(psGet).toHaveBeenCalledTimes(1);
    expect(store._store.sessions).toEqual([]);
  });
});

describe("_ensureInit · 异步权威覆盖", () => {
  it("pluginState 有会话 ⇒ 覆盖 localStorage 的、并把结果回写 localStorage、通知 listener", async () => {
    seedLocal([{ id: "s-local", name: "本地旧的" }]);
    psGet.mockResolvedValue({ sessions: [{ id: "s-cloud", name: "权威的" }], activeSessionId: "s-cloud", sessionCounter: 3, colorIndex: 2 });
    const { store, persist } = await bootLazy();
    const notified = vi.fn();
    store._sessionListeners.add(notified);

    persist._ensureInit();
    await flush();

    expect(store._store.sessions.map((s) => s.id)).toEqual(["s-cloud"]);
    expect(store._store.sessionCounter).toBe(3);
    expect(store._store.colorIndex).toBe(2);
    expect(store._readLocal()?.sessions).toHaveLength(1);
    expect((store._readLocal()?.sessions as { id: string }[])[0].id).toBe("s-cloud");
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("pluginState 里**没有** sessions（空快照）⇒ 不覆盖、不回写、不通知（localStorage 那份留着）", async () => {
    seedLocal([{ id: "s-local", name: "本地" }]);
    psGet.mockResolvedValue({ colorIndex: 9 });
    const { store, persist } = await bootLazy();
    const notified = vi.fn();
    store._sessionListeners.add(notified);

    persist._ensureInit();
    await flush();

    expect(store._store.sessions.map((s) => s.id)).toEqual(["s-local"]);
    expect(store._store.colorIndex).toBe(0); // 空快照整份不 _applyStore
    expect(notified).not.toHaveBeenCalled();
  });

  it("pluginState.get 抛错/拒绝 ⇒ 静默（同步恢复那份继续可用）", async () => {
    seedLocal([{ id: "s-local", name: "本地" }]);
    psGet.mockRejectedValue(new Error("IPC 挂了"));
    const { store, persist } = await bootLazy();

    persist._ensureInit();
    await flush();

    expect(store._store.sessions.map((s) => s.id)).toEqual(["s-local"]);
  });
});

describe("_ensureInit · 跨 WebView 广播", () => {
  it("订阅 serial:storeChanged —— 收到他端广播就应用 + 通知 listener", async () => {
    const store = await boot();
    const notified = vi.fn();
    store._sessionListeners.add(notified);

    handlers.get("serial:storeChanged")!({ sessions: [{ id: "s-other", name: "他端" }], activeSessionId: "s-other" });

    expect(store._store.sessions.map((s) => s.id)).toEqual(["s-other"]);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("自回环跳过：上次本地快照 == 收到的广播 ⇒ 一个字段都不动、不通知", async () => {
    const store = await boot();
    const payload = { sessions: [{ id: "s-self", name: "自己发的" }], activeSessionId: "s-self" };
    store.setLastLocalSnapshot(JSON.stringify(payload));
    const notified = vi.fn();
    store._sessionListeners.add(notified);

    handlers.get("serial:storeChanged")!(payload);

    expect(store._store.sessions).toEqual([]);
    expect(notified).not.toHaveBeenCalled();
  });

  it("应用过的他端广播会被记成新快照 —— 同一份再来一次即被跳过（防重复应用）", async () => {
    const store = await boot();
    const payload = { sessions: [{ id: "s-other", name: "他端" }], activeSessionId: "s-other" };
    const notified = vi.fn();

    handlers.get("serial:storeChanged")!(payload);
    store._sessionListeners.add(notified);
    handlers.get("serial:storeChanged")!(payload); // 同内容第二次

    expect(notified).not.toHaveBeenCalled();

    // 去重不能把通道焊死：换一份新内容仍要能应用
    handlers.get("serial:storeChanged")!({ sessions: [{ id: "s-third", name: "第三份" }] });
    expect(store._store.sessions.map((s) => s.id)).toEqual(["s-third"]);
  });
});
