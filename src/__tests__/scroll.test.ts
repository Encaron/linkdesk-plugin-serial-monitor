/**
 * scroll——CM6 智能滚底（用户停在底部才跟随，上滚后不打扰）。
 * 判据：atBottom 的容差边界逐点（SCROLL_AT_BOTTOM_TOLERANCE）/ 只在文档变更时滚 /
 *      上滚后不滚、滚回底部恢复 / 滚底位置取文档末尾 / rAF 延后执行。
 *
 * ⚠️ 反射断言口径：**不建真视口、不碰 DOM**——`scrollDOM` 是替身对象（只有 addEventListener
 *    与三个几何字段）；ViewPlugin 的值用 `fromClass` 的 create 工厂直接造（真视图内部就是这么挂的）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { scrollTracker } from "../cm6/scroll";
import { SCROLL_AT_BOTTOM_TOLERANCE } from "../constants";

type PluginValue = { update: (update: unknown) => void };
type Spec = Parameters<EditorState["update"]>[0];

function mount(doc = "line") {
  let state = EditorState.create({ doc });
  const scrollListeners: Record<string, { cb: () => void; opts?: unknown }> = {};
  const scrollDOM = {
    scrollHeight: 300,
    scrollTop: 200,
    clientHeight: 100,
    addEventListener: (ev: string, cb: () => void, opts?: unknown) => {
      scrollListeners[ev] = { cb, opts };
    },
  };
  const effects: unknown[] = [];
  const view = {
    scrollDOM,
    get state() { return state; },
    dispatch: (spec: Spec) => {
      const ef = (spec as { effects?: unknown }).effects;
      if (ef) effects.push(...(Array.isArray(ef) ? ef : [ef]));
      state = state.update(spec).state;
    },
  };
  const value = (scrollTracker as unknown as { create: (v: unknown) => PluginValue }).create(view);
  /** 模拟用户滚到「距底 remaining 像素」处（300 高 − 100 视口 = 可滚 200） */
  const scrollTo = (remaining: number) => {
    scrollDOM.scrollTop = 200 - remaining;
    scrollListeners.scroll.cb();
  };
  return { value, view: view as unknown as EditorView & { state: EditorState }, effects, scrollListeners, scrollTo };
}

/** scrollIntoView 效果的目标位置——value 形如 { range: { anchor }, y: "end", … }；非它则 undefined */
function scrollTargetOf(effect: unknown): number | undefined {
  const v = (effect as { value?: { y?: string; range?: { anchor?: number } } }).value;
  return v?.y === "end" ? v.range?.anchor : undefined;
}

function docLen(view: { state: EditorState }): number {
  return view.state.doc.length;
}

describe("scrollTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("挂载时在 scrollDOM 上注册 scroll 监听，且是 passive（滚动热路径不阻塞）", () => {
    const { scrollListeners } = mount();

    expect(Object.keys(scrollListeners)).toEqual(["scroll"]);
    expect(scrollListeners.scroll.opts).toEqual({ passive: true });
  });

  it("初期视为在底部：docChanged → 派发 scrollIntoView 到文档末尾（y=end）", () => {
    vi.useFakeTimers();
    const { value, view, effects } = mount("line");
    view.dispatch({ changes: { from: 4, insert: "\nmore" } }); // 文档变长（视图同步 state）

    value.update({ docChanged: true, view });
    vi.advanceTimersByTime(50);

    expect(effects).toHaveLength(1);
    expect(scrollTargetOf(effects[0])).toBe(docLen(view));
    expect(docLen(view)).toBe("line\nmore".length);
  });

  it("无文档变更（只移动光标/选区）→ 不滚（不打扰用户的浏览位置）", () => {
    vi.useFakeTimers();
    const { value, view, effects } = mount();

    value.update({ docChanged: false, view });
    vi.advanceTimersByTime(50);

    expect(effects).toHaveLength(0);
  });

  it("容差边界：距底恰好 = SCROLL_AT_BOTTOM_TOLERANCE → **不算**在底部，不滚", () => {
    vi.useFakeTimers();
    const { value, view, effects, scrollTo } = mount();

    scrollTo(SCROLL_AT_BOTTOM_TOLERANCE);
    value.update({ docChanged: true, view });
    vi.advanceTimersByTime(50);

    expect(effects).toHaveLength(0);
  });

  it("容差边界：距底 = 容差 − 1 → 仍在底部，照滚", () => {
    vi.useFakeTimers();
    const { value, view, effects, scrollTo } = mount();

    scrollTo(SCROLL_AT_BOTTOM_TOLERANCE - 1);
    value.update({ docChanged: true, view });
    vi.advanceTimersByTime(50);

    expect(effects).toHaveLength(1);
    expect(scrollTargetOf(effects[0])).toBe(docLen(view));
  });

  it("用户上滚离开底部 → 新数据来了也不滚", () => {
    vi.useFakeTimers();
    const { value, view, effects, scrollTo } = mount();

    scrollTo(500);
    value.update({ docChanged: true, view });
    vi.advanceTimersByTime(50);

    expect(effects).toHaveLength(0);
  });

  it("上滚后再滚回底部 → 恢复跟随（下一次 docChanged 又滚）", () => {
    vi.useFakeTimers();
    const { value, view, effects, scrollTo } = mount();

    scrollTo(500);
    value.update({ docChanged: true, view });
    vi.advanceTimersByTime(50);
    expect(effects).toHaveLength(0);

    scrollTo(0);
    value.update({ docChanged: true, view });
    vi.advanceTimersByTime(50);

    expect(effects).toHaveLength(1);
  });

  it("滚底由 rAF 延后执行——同步阶段不派发（不打断本轮渲染）", () => {
    vi.useFakeTimers();
    const { value, view, effects } = mount();

    value.update({ docChanged: true, view });
    expect(effects).toHaveLength(0);

    vi.advanceTimersByTime(50);
    expect(effects).toHaveLength(1);
  });
});
