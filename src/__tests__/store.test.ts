/**
 * store——会话表模块级单例 ＋ 持久化写入（替身层）。
 * 判据：`_applyStore` 逐字段**窄化**（类型不对/缺键就一个字段都不动）/ `_readLocal` 的双 key 兜底与脏数据不炸 /
 *       `_writeLocal` 的静默容错 / `_notify` 的**广播去重**（自己 emit 的广播回来必须跳过，否则两个 WebView 无限对推）。
 *
 * 替身来源：`window.linkdesk.pluginState` 共享 mock 里**没有**（插件专属能力）⇒ 本文件用 `vi.fn()` 就地补；
 * localStorage 由 jsdom 提供**真实现**（脏数据路径要的就是真 JSON.parse 行为，替换掉就测不到 catch 了）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  _applyStore, _notify, _persist, _readLocal, _sessionListeners, _store, _writeLocal,
  STORAGE_KEY, setLastLocalSnapshot,
} from "../hooks/useSerialSessions/store";
import type { SerialSession } from "../hooks/useSerialSessions/types";

type LkTest = {
  pluginState?: { get: unknown; set: unknown };
  events?: { on: unknown; emit: unknown };
};

const lk = () => window.linkdesk as unknown as LkTest;

/** 造一个最小会话（只放断言用得到的字段——`_applyStore` 只做整体 map，不逐字段校验会话内部形状） */
function session(id: string, extra: Record<string, unknown> = {}): SerialSession {
  return { id, name: id, connected: true, ...extra } as unknown as SerialSession;
}

/** pluginState 桩——返回 set 的 spy（返回值必须是 Promise：生产里 `.catch` 挂在它上面） */
function stubPluginState(getResult: unknown = undefined) {
  const set = vi.fn(() => Promise.resolve());
  lk().pluginState = { get: vi.fn(() => Promise.resolve(getResult)), set };
  return set;
}

let emit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _store.sessions = [];
  _store.activeSessionId = null;
  _store.sessionCounter = 0;
  _store.colorIndex = 0;
  _sessionListeners.clear();
  setLastLocalSnapshot(""); // `_lastLocalSnapshot` 是模块私有 let——只经这一个写入口重置
  localStorage.clear();
  emit = vi.fn();
  lk().events = { on: () => () => {}, emit };
});

afterEach(() => {
  delete lk().pluginState; // 插件专属桩不外溢到同文件其它 describe
});

describe("_applyStore（快照 → store 的逐字段窄化）", () => {
  it("sessions：整体换新数组，且**逐条强制 connected=false**（跨 WebView/重启恢复时连接不可能还活着）", () => {
    const incoming = session("s-a");

    _applyStore({ sessions: [incoming] });

    expect(_store.sessions).toHaveLength(1);
    expect(_store.sessions[0].connected).toBe(false);
    expect(_store.sessions[0]).not.toBe(incoming); // 复制而非引用——改本地不串回广播数据
  });

  it("sessions 不是数组（脏数据）⇒ sessions 不动；其余字段**各按自己的类型判**（字段间互不牵连）", () => {
    _store.sessions = [session("s-keep")];
    _store.activeSessionId = "s-keep";

    _applyStore({ sessions: "oops", activeSessionId: "s-other", colorIndex: 4 });

    expect(_store.sessions.map((s) => s.id)).toEqual(["s-keep"]); // 坏字段只管自己不写别人
    expect(_store.activeSessionId).toBe("s-other");
    expect(_store.colorIndex).toBe(4);
  });

  it("activeSessionId / sessionCounter / colorIndex：类型对才写，类型不对原样保留", () => {
    _applyStore({ activeSessionId: "s-x", sessionCounter: 7, colorIndex: 3 });
    expect(_store.activeSessionId).toBe("s-x");
    expect(_store.sessionCounter).toBe(7);
    expect(_store.colorIndex).toBe(3);

    _applyStore({ activeSessionId: 42, sessionCounter: "9", colorIndex: null });
    expect(_store.activeSessionId).toBe("s-x");
    expect(_store.sessionCounter).toBe(7);
    expect(_store.colorIndex).toBe(3);
  });

  it("⚠️ 语义登记：广播里的 activeSessionId=null **不会**清空本地活跃口（`typeof null === \"object\"` 过不了窄化）", () => {
    // 现状即契约：另一 WebView「取消选中」时本地仍指着旧 id。登记在交接段，⛔ 本轮不改生产代码。
    _store.activeSessionId = "s-keep";

    _applyStore({ activeSessionId: null });

    expect(_store.activeSessionId).toBe("s-keep");
  });

  it("认不出的键一律忽略（快照带旧版本字段不炸）", () => {
    expect(() => _applyStore({ legacyThing: 1, sessions: [session("s-a")] })).not.toThrow();
    expect(_store.sessions.map((s) => s.id)).toEqual(["s-a"]);
  });
});

describe("_readLocal / _writeLocal（localStorage 同步兜底）", () => {
  it("写的是四个字段的快照，读回来能原样对上", () => {
    _store.sessions = [session("s-a")];
    _store.activeSessionId = "s-a";
    _store.sessionCounter = 2;
    _store.colorIndex = 1;

    _writeLocal();

    expect(_readLocal()).toEqual({
      sessions: [{ id: "s-a", name: "s-a", connected: true }],
      activeSessionId: "s-a",
      sessionCounter: 2,
      colorIndex: 1,
    });
  });

  it("新 key 缺失时回落旧 key（terminal 时代的历史数据——老用户升级不丢会话）", () => {
    localStorage.setItem("linkdesk:terminal:sessions", JSON.stringify({ sessions: [session("s-old")] }));

    expect(_readLocal()?.sessions).toHaveLength(1);

    // 新 key 在场时以新 key 为准
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: [] }));
    expect(_readLocal()?.sessions).toHaveLength(0);
  });

  it("脏 JSON ⇒ null（不抛——持久化坏了不能连累启动）", () => {
    localStorage.setItem(STORAGE_KEY, "{不是 JSON");

    expect(() => _readLocal()).not.toThrow();
    expect(_readLocal()).toBeNull();
  });

  it("localStorage 抛异常（配额满/隐私模式）⇒ 读写都静默", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });

    expect(() => _writeLocal()).not.toThrow();

    spy.mockRestore();
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(_readLocal()).toBeNull();
    getSpy.mockRestore();
  });
});

describe("_persist（双写：pluginState 权威 + localStorage 兜底）", () => {
  it("把快照交给 pluginState.set（key=serial-monitor/sessions），同一份也落 localStorage", () => {
    const set = stubPluginState();
    _store.sessions = [session("s-a")];

    _persist();

    expect(set).toHaveBeenCalledWith("serial-monitor", "sessions", expect.objectContaining({ activeSessionId: null }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY!)!).sessions).toHaveLength(1);
  });

  it("pluginState 缺席（共享 mock 的常态）⇒ 不炸，localStorage 照写", () => {
    delete lk().pluginState;

    expect(() => _persist()).not.toThrow();
    expect(localStorage.getItem(STORAGE_KEY!)).toBeTruthy();
  });

  it("pluginState.set 失败 ⇒ 被 catch 掉（只打日志，不冒泡成 unhandled rejection）", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const set = vi.fn(() => Promise.reject(new Error("写盘失败")));
    lk().pluginState = { get: vi.fn(() => Promise.resolve(undefined)), set };

    _persist();
    await Promise.resolve();
    await Promise.resolve();

    expect(err).toHaveBeenCalledWith("[serial-monitor] 保存会话失败:", expect.any(Error));
    err.mockRestore();
  });
});

describe("_notify（通知 + 广播去重）", () => {
  it("先落盘再逐个通知 listener（顺序即契约：listener 醒来时数据已持久化）", () => {
    const order: string[] = [];
    const set = vi.fn(() => { order.push("persist"); return Promise.resolve(); });
    lk().pluginState = { get: vi.fn(() => Promise.resolve(undefined)), set };
    _sessionListeners.add(() => order.push("listener"));

    _notify();

    expect(order).toEqual(["persist", "listener"]);
  });

  it("首次通知发广播 serial:storeChanged，载荷 = 四个字段", () => {
    _store.sessions = [session("s-a")];
    _store.sessionCounter = 1;

    _notify();

    expect(emit).toHaveBeenCalledWith("serial:storeChanged", {
      sessions: _store.sessions,
      activeSessionId: null,
      sessionCounter: 1,
      colorIndex: 0,
    });
  });

  it("状态没变 ⇒ **不**再广播（两个 WebView 对推的刹车片）", () => {
    _notify();
    expect(emit).toHaveBeenCalledTimes(1);

    _notify();
    _notify();
    expect(emit).toHaveBeenCalledTimes(1);

    _store.sessionCounter = 5;
    _notify();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("listener 抛错 ⇒ 冒泡出去（不动 state 的可测边界——本函数不做 listener 级容错）", () => {
    _sessionListeners.add(() => { throw new Error("listener 坏了"); });

    expect(() => _notify()).toThrow("listener 坏了");
  });
});
