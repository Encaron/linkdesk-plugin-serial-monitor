/**
 * receiveSnapshots——合屏迁移快照（E5.8#30.14 方向 c）。
 * 判据：CM6 每行文本 + 行色**逐行**还原（行色靠 lineDecoField 的行装饰反查）；
 * 无装饰行回落 received；模块级 `_receiveSnapshots` 是**单一属主**（key = sourceId，跨组共享）。
 *
 * ⚠️ 反射断言口径：只造 `EditorState`（不建真视口、不碰 DOM）；`EditorView` 仅作 typed 外壳。
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { _receiveSnapshots, snapshotCmLines } from "../services/receiveSnapshots";
import { addLineDeco, lineDecoField } from "../cm6/decorations";
import type { LineType } from "../types";

/** 造一个只带 state 的 EditorView 外壳——snapshotCmLines 只读 state.doc / state.field */
function makeView(doc: string, decos: { from: number; cls: string }[] = []): EditorView {
  const state = EditorState.create({ doc, extensions: [lineDecoField] })
    .update({ effects: decos.map((d) => addLineDeco.of(d)) })
    .state;
  return { state } as unknown as EditorView;
}

describe("snapshotCmLines", () => {
  it("逐行取文本，行色由该行的行装饰决定（received/sent/system 三色）", () => {
    const view = makeView("l1\nl2\nl3", [
      { from: 0, cls: "cm-line-received" },
      { from: 3, cls: "cm-line-sent" },
      { from: 6, cls: "cm-line-system" },
    ]);

    expect(snapshotCmLines(view)).toEqual<{ text: string; type: LineType }[]>([
      { text: "l1", type: "received" },
      { text: "l2", type: "sent" },
      { text: "l3", type: "system" },
    ]);
  });

  it("无行装饰的行回落 received（接收区绝大多数行是收到）", () => {
    const view = makeView("l1\nl2", [{ from: 3, cls: "cm-line-sent" }]);

    expect(snapshotCmLines(view)).toEqual([
      { text: "l1", type: "received" },
      { text: "l2", type: "sent" },
    ]);
  });

  it("认不出的装饰类名不算数——回落 received（装饰系统与快照系统解耦）", () => {
    const view = makeView("l1", [{ from: 0, cls: "cm-line-unknown" }]);

    expect(snapshotCmLines(view)).toEqual([{ text: "l1", type: "received" }]);
  });

  it("行起点偏移按「行长 + 1」累积——跳过两行仍能命中（末行越界 1 无害）", () => {
    // "l1"(0) → "l22" = 0+2+1 = 3 → "l3" = 3+3+1 = 7；把 system 装饰放第三行
    const view = makeView("l1\nl22\nl3", [{ from: 7, cls: "cm-line-system" }]);

    expect(snapshotCmLines(view)).toEqual([
      { text: "l1", type: "received" },
      { text: "l22", type: "received" },
      { text: "l3", type: "system" },
    ]);
  });

  it("空文档 → 一行空文本（CM6 空 state 也有一个空行）", () => {
    expect(snapshotCmLines(makeView(""))).toEqual([{ text: "", type: "received" }]);
  });

  it("装饰落在非行首位置 → 不认（行色只按行起点匹配，行内装饰不染色）", () => {
    const view = makeView("l1\nl2", [{ from: 1, cls: "cm-line-sent" }]);

    expect(snapshotCmLines(view)).toEqual([
      { text: "l1", type: "received" },
      { text: "l2", type: "received" },
    ]);
  });
});

describe("_receiveSnapshots（模块级单一属主）", () => {
  it("按 sourceId 存取删——跨组迁移就是「同一个 map 换 key 读」", () => {
    _receiveSnapshots.clear();
    const snap = { lines: [{ text: "l1", type: "received" as LineType }], hexLines: [], ring: [] };

    _receiveSnapshots.set("s-demo", snap);
    expect(_receiveSnapshots.get("s-demo")).toBe(snap);

    _receiveSnapshots.delete("s-demo");
    expect(_receiveSnapshots.get("s-demo")).toBeUndefined();
    _receiveSnapshots.clear();
  });

  it("不同会话各存各的——一个会话的快照不会串到另一个", () => {
    _receiveSnapshots.clear();
    const a = { lines: [{ text: "A", type: "received" as LineType }], hexLines: [], ring: [] };
    const b = { lines: [{ text: "B", type: "sent" as LineType }], hexLines: [], ring: [] };

    _receiveSnapshots.set("s-a", a);
    _receiveSnapshots.set("s-b", b);

    expect(_receiveSnapshots.get("s-a")?.lines[0].text).toBe("A");
    expect(_receiveSnapshots.get("s-b")?.lines[0].text).toBe("B");
    _receiveSnapshots.clear();
  });
});
