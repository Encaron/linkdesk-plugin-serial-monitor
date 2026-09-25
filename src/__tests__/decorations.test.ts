/**
 * decorations——CM6 行装饰系统（三色行 + 时间戳前缀 mark）+ 清空效果。
 * 判据：两个 StateField 的 create/update 逐条（加装饰 / 清空 / **随文档变更重映射**）。
 *
 * ⚠️ 反射断言口径：只造 `EditorState`，不建真视口、不碰 DOM。
 */
import { describe, it, expect } from "vitest";
import { EditorState, type RangeSet, type StateField } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import {
  addLineDeco, addTimestampMark, clearAllDecos, lineDecoField, timestampMarkField,
} from "../cm6/decorations";

function makeState(doc: string) {
  return EditorState.create({ doc, extensions: [lineDecoField, timestampMarkField] });
}

/** 取出某个装饰域里的 (from, to, cls) 列表 */
function rangesOf(field: StateField<RangeSet<Decoration>>, state: EditorState): string[] {
  const out: string[] = [];
  state.field(field).between(0, Math.max(state.doc.length, 1), (from, to, deco) => {
    out.push(`${from}-${to}:${String(deco.spec?.class ?? "")}`);
  });
  return out;
}

describe("lineDecoField", () => {
  it("create：初始为空集", () => {
    const state = makeState("a\nb");
    expect(state.field(lineDecoField).size).toBe(0);
  });

  it("addLineDeco：按 from 落一条行装饰，cls 原样带出", () => {
    const state = makeState("a\nb").update({
      effects: addLineDeco.of({ from: 0, cls: "cm-line-received" }),
    }).state;

    expect(state.field(lineDecoField).size).toBe(1);
    expect(rangesOf(lineDecoField, state)).toEqual(["0-0:cm-line-received"]);
  });

  it("多条装饰按 from 排序落在各自位置", () => {
    const state = makeState("a\nb\nc").update({
      effects: [
        addLineDeco.of({ from: 4, cls: "cm-line-system" }),
        addLineDeco.of({ from: 0, cls: "cm-line-received" }),
      ],
    }).state;

    expect(state.field(lineDecoField).size).toBe(2);
    expect(rangesOf(lineDecoField, state)).toEqual(["0-0:cm-line-received", "4-4:cm-line-system"]);
  });

  it("文档变更：已有装饰**随变更重映射**（在前方插入 → 位置右移）", () => {
    const withDeco = makeState("abc").update({
      effects: addLineDeco.of({ from: 1, cls: "cm-line-sent" }),
    }).state;
    expect(rangesOf(lineDecoField, withDeco)).toEqual(["1-1:cm-line-sent"]);

    const shifted = withDeco.update({ changes: { from: 0, insert: "XX" } }).state;

    expect(rangesOf(lineDecoField, shifted)).toEqual(["3-3:cm-line-sent"]);
  });

  it("文档变更：删除跨越装饰位置 → 装饰跟着收缩/移动，不残留越界范围", () => {
    const withDeco = makeState("abcdef").update({
      effects: addLineDeco.of({ from: 4, cls: "cm-line-sent" }),
    }).state;

    const shrunk = withDeco.update({ changes: { from: 1, to: 3 } }).state;

    expect(rangesOf(lineDecoField, shrunk)).toEqual(["2-2:cm-line-sent"]);
  });

  it("clearAllDecos：整域清空", () => {
    const withDecos = makeState("a\nb").update({
      effects: [
        addLineDeco.of({ from: 0, cls: "cm-line-received" }),
        addLineDeco.of({ from: 2, cls: "cm-line-sent" }),
      ],
    }).state;
    expect(withDecos.field(lineDecoField).size).toBe(2);

    const cleared = withDecos.update({ effects: clearAllDecos.of(null) }).state;

    expect(cleared.field(lineDecoField).size).toBe(0);
  });
});

describe("timestampMarkField", () => {
  it("create：初始为空集", () => {
    expect(makeState("a").field(timestampMarkField).size).toBe(0);
  });

  it("addTimestampMark：落一条 cm-timestamp 区间 mark（from/to 原样）", () => {
    const state = makeState("prefix-body").update({
      effects: addTimestampMark.of({ from: 0, to: 7 }),
    }).state;

    expect(rangesOf(timestampMarkField, state)).toEqual(["0-7:cm-timestamp"]);
  });

  it("mark 与行装饰互不干扰（两个域各自持有）", () => {
    const state = makeState("a\nb").update({
      effects: [
        addLineDeco.of({ from: 0, cls: "cm-line-received" }),
        addTimestampMark.of({ from: 0, to: 1 }),
      ],
    }).state;

    expect(state.field(lineDecoField).size).toBe(1);
    expect(state.field(timestampMarkField).size).toBe(1);
  });

  it("mark 也随文档变更重映射", () => {
    const withMark = makeState("abc").update({
      effects: addTimestampMark.of({ from: 0, to: 2 }),
    }).state;

    const shifted = withMark.update({ changes: { from: 0, insert: "X" } }).state;

    expect(rangesOf(timestampMarkField, shifted)).toEqual(["1-3:cm-timestamp"]);
  });

  it("clearAllDecos 同时清两个域（一个效果管全部装饰）", () => {
    const withBoth = makeState("a\nb").update({
      effects: [
        addLineDeco.of({ from: 0, cls: "cm-line-received" }),
        addTimestampMark.of({ from: 0, to: 1 }),
      ],
    }).state;

    const cleared = withBoth.update({ effects: clearAllDecos.of(null) }).state;

    expect(cleared.field(lineDecoField).size).toBe(0);
    expect(cleared.field(timestampMarkField).size).toBe(0);
  });
});
