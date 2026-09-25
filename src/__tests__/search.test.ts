/**
 * search——CM6 搜索高亮装饰（命中集 + 当前项推进 + 空结果）。
 * 判据：命中项类名集合稳定（cm-search-match / cm-search-current）/ current 是 **1 基**序号
 *      （0 = 无当前项）/ 重设即替换 / 清空即空 / 随文档变更重映射。
 *
 * ⚠️ 反射断言口径：只造 `EditorState`，不建真视口、不碰 DOM。
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import type { RangeSet } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { clearSearchDecos, searchDecoField, setSearchDecos } from "../cm6/search";

function makeState(doc: string) {
  return EditorState.create({ doc, extensions: [searchDecoField] });
}

/** 取出命中装饰的 (from-to, 类名) 列表 */
function matchesOf(state: EditorState): string[] {
  const out: string[] = [];
  const field: RangeSet<Decoration> = state.field(searchDecoField);
  field.between(0, Math.max(state.doc.length, 1), (from, to, deco) => {
    out.push(`${from}-${to}:${String(deco.spec?.class ?? "")}`);
  });
  return out;
}

describe("searchDecoField", () => {
  it("create：初始无命中", () => {
    expect(makeState("abc").field(searchDecoField).size).toBe(0);
  });

  it("current 是 1 基：current=2 → 第 2 条当前项、其余普通命中", () => {
    const state = makeState("abcdefgh").update({
      effects: setSearchDecos.of({
        matches: [{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 6, to: 8 }],
        current: 2,
      }),
    }).state;

    expect(matchesOf(state)).toEqual([
      "0-2:cm-search-match",
      "3-5:cm-search-current",
      "6-8:cm-search-match",
    ]);
  });

  it("current=1 → 第一条是当前项", () => {
    const state = makeState("abcdef").update({
      effects: setSearchDecos.of({ matches: [{ from: 0, to: 2 }, { from: 3, to: 5 }], current: 1 }),
    }).state;

    expect(matchesOf(state)).toEqual(["0-2:cm-search-current", "3-5:cm-search-match"]);
  });

  it("current=0 → **没有**当前项（全部是普通命中，界面无「当前」强调）", () => {
    const state = makeState("abcdef").update({
      effects: setSearchDecos.of({ matches: [{ from: 0, to: 2 }, { from: 3, to: 5 }], current: 0 }),
    }).state;

    expect(matchesOf(state)).toEqual(["0-2:cm-search-match", "3-5:cm-search-match"]);
  });

  it("空命中集（搜不到）→ 空装饰，不抛错", () => {
    const state = makeState("abcdef").update({
      effects: setSearchDecos.of({ matches: [], current: 0 }),
    }).state;

    expect(state.field(searchDecoField).size).toBe(0);
  });

  it("重设（换关键词）→ 旧命中被整体替换，不叠加", () => {
    const first = makeState("abcdef").update({
      effects: setSearchDecos.of({ matches: [{ from: 0, to: 2 }], current: 1 }),
    }).state;
    expect(first.field(searchDecoField).size).toBe(1);

    const second = first.update({
      effects: setSearchDecos.of({ matches: [{ from: 4, to: 6 }], current: 1 }),
    }).state;

    expect(matchesOf(second)).toEqual(["4-6:cm-search-current"]);
  });

  it("current 推进：同一组命中换 current → 只有强调项换位，命中集不变", () => {
    const matches = [{ from: 0, to: 2 }, { from: 3, to: 5 }];
    const atOne = makeState("abcdef").update({ effects: setSearchDecos.of({ matches, current: 1 }) }).state;
    const atTwo = atOne.update({ effects: setSearchDecos.of({ matches, current: 2 }) }).state;

    expect(matchesOf(atOne)).toEqual(["0-2:cm-search-current", "3-5:cm-search-match"]);
    expect(matchesOf(atTwo)).toEqual(["0-2:cm-search-match", "3-5:cm-search-current"]);
  });

  it("clearSearchDecos → 整域清空（关搜索栏时）", () => {
    const withMatches = makeState("abcdef").update({
      effects: setSearchDecos.of({ matches: [{ from: 0, to: 2 }], current: 1 }),
    }).state;

    const cleared = withMatches.update({ effects: clearSearchDecos.of(null) }).state;

    expect(cleared.field(searchDecoField).size).toBe(0);
  });

  it("文档变更：命中装饰随变更重映射（在前方插入 → 整体右移）", () => {
    const withMatches = makeState("abcdef").update({
      effects: setSearchDecos.of({ matches: [{ from: 0, to: 2 }], current: 1 }),
    }).state;

    const shifted = withMatches.update({ changes: { from: 0, insert: "XY" } }).state;

    expect(matchesOf(shifted)).toEqual(["2-4:cm-search-current"]);
  });

  it("命中区间紧邻/相接时互不吞并（逐条独立 mark）", () => {
    const state = makeState("aaaa").update({
      effects: setSearchDecos.of({ matches: [{ from: 0, to: 1 }, { from: 1, to: 2 }], current: 1 }),
    }).state;

    expect(matchesOf(state)).toEqual(["0-1:cm-search-current", "1-2:cm-search-match"]);
  });
});
