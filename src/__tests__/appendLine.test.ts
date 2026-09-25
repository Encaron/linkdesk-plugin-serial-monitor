/**
 * appendLine——CM6 追加一行（带颜色），接收区核心写入，主栏 / HEX 栏共用。
 * 判据：空视图 no-op / 首行不加前导换行 / 行装饰落在行首 / 时间戳前缀的 mark 范围 /
 *      超 CM6_MAX_DOC_LINES 触发一次裁剪。
 *
 * ⚠️ 反射断言口径：state 用**真 CM6**（EditorState + 真 StateField），view 只造一个
 *    「dispatch 即 state.update」的最小外壳——⛔ 不建真视口、⛔ 不碰 DOM。
 *    外壳的语义与 CM6 视图一致：dispatch(spec) 就是把事务应用到 state。
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { appendLineToView } from "../cm6/appendLine";
import { lineDecoField, timestampMarkField } from "../cm6/decorations";
import { CM6_MAX_DOC_LINES, CM6_TRIM_KEEP_LINES } from "../constants";

type Spec = Parameters<EditorState["update"]>[0];

function makeView(doc = ""): { view: EditorView; state: () => EditorState } {
  let state = EditorState.create({ doc, extensions: [lineDecoField, timestampMarkField] });
  const view = {
    get state() { return state; },
    dispatch(spec: Spec) { state = state.update(spec).state; },
  };
  return { view: view as unknown as EditorView, state: () => state };
}

/** 取行装饰：from → 类名 */
function lineDecos(state: EditorState): Record<number, string> {
  const out: Record<number, string> = {};
  state.field(lineDecoField).between(0, state.doc.length, (from, _to, deco) => {
    out[from] = String(deco.spec?.class ?? "");
  });
  return out;
}

/** 取时间戳 mark 装饰的区间 */
function timestampMarks(state: EditorState): string[] {
  const out: string[] = [];
  state.field(timestampMarkField).between(0, state.doc.length, (from, to) => {
    out.push(`${from}-${to}`);
  });
  return out;
}

describe("appendLineToView", () => {
  it("视图为 null → no-op，不抛错（编辑器还没 mount 时到达的数据）", () => {
    expect(() => appendLineToView(null, "hello", "received")).not.toThrow();
  });

  it("空文档：首行不插前导换行", () => {
    const { view, state } = makeView();

    appendLineToView(view, "hello", "received");

    expect(state().doc.toString()).toBe("hello");
    expect(state().doc.lines).toBe(1);
  });

  it("非空文档：新行以 \\n 接在末尾（第一行前面必须有换行）", () => {
    const { view, state } = makeView("first");

    appendLineToView(view, "second", "received");

    expect(state().doc.toString()).toBe("first\nsecond");
    expect(state().doc.lines).toBe(2);
  });

  it("行装饰落在新行行首，类名 = cm-line-<色>（三色逐条）", () => {
    const { view, state } = makeView(); // 空文档起手：首行 from=0，之后每行首 = 前行长 + 1
    appendLineToView(view, "recv", "received");
    appendLineToView(view, "send", "sent");
    appendLineToView(view, "sys", "system");

    expect(lineDecos(state())).toEqual({
      0: "cm-line-received",
      5: "cm-line-sent",
      10: "cm-line-system",
    });
  });

  it("received 带时间戳前缀（\"时间 -> \"）→ 前缀整体挂 cm-timestamp mark", () => {
    const { view, state } = makeView();
    const text = "12:00:00:000 -> payload"; // " -> " 起点 12 ⇒ mark 到 12+4

    appendLineToView(view, text, "received");

    expect(timestampMarks(state())).toEqual(["0-16"]);
  });

  it("sent 带分隔（\" ---- \"）→ 前缀整体挂 cm-timestamp mark", () => {
    const { view, state } = makeView();
    const text = "12:00:00:000 ---- 已发送"; // dashIdx 12 ⇒ mark 到 12+5

    appendLineToView(view, text, "sent");

    expect(timestampMarks(state())).toEqual(["0-17"]);
  });

  it("received 无 \" -> \" → 不打时间戳 mark（不是所有收到行都带前缀）", () => {
    const { view, state } = makeView();

    appendLineToView(view, "no prefix here", "received");

    expect(timestampMarks(state())).toEqual([]);
  });

  it("sent 无 \" ---- \" → 不打时间戳 mark", () => {
    const { view, state } = makeView();

    appendLineToView(view, "plain sent", "sent");

    expect(timestampMarks(state())).toEqual([]);
  });

  it("system 行不打时间戳 mark（只有 received/sent 有前缀语义）", () => {
    const { view, state } = makeView();

    appendLineToView(view, "12:00:00:000 -> sys", "system");

    expect(timestampMarks(state())).toEqual([]);
  });

  it("第二轮追加的行首偏移正确（换行计入偏移）", () => {
    const { view, state } = makeView();
    appendLineToView(view, "aaa", "received"); // doc "aaa"，行首 0
    appendLineToView(view, "bbb", "received"); // doc "aaa\nbbb"，行首 4

    expect(lineDecos(state())).toEqual({ 0: "cm-line-received", 4: "cm-line-received" });
  });

  it("行数未超上限时**不**裁剪（文档原样保留）", () => {
    const lines = Array.from({ length: CM6_MAX_DOC_LINES - 1 }, (_, i) => `L${i + 1}`);
    const { view, state } = makeView(lines.join("\n"));

    appendLineToView(view, "tail", "received");

    expect(state().doc.lines).toBe(CM6_MAX_DOC_LINES);
    expect(state().doc.line(1).text).toBe("L1");
  });

  it("行数超上限 → 触发一次裁剪，只保留尾部（切断点在 CM6_TRIM_KEEP_LINES 行首）", () => {
    const lines = Array.from({ length: CM6_MAX_DOC_LINES }, (_, i) => `L${i + 1}`);
    const { view, state } = makeView(lines.join("\n"));

    appendLineToView(view, "tail", "received"); // 2001 → 2002 行，超上限

    // ⚠️ 现状即契约：切断点是 line(CM6_TRIM_KEEP_LINES).from ⇒ 保留 = 总行数 − KEEP + 1 行
    //    （常量名叫 KEEP_LINES 但实际保留远多于 KEEP——登记在交接段，⛔ 本轮不改生产代码）
    const expectedRemaining = CM6_MAX_DOC_LINES + 1 - CM6_TRIM_KEEP_LINES + 1;
    expect(state().doc.lines).toBe(expectedRemaining);
    expect(state().doc.lines).toBeLessThanOrEqual(CM6_MAX_DOC_LINES);
    // 尾部是保留侧：第 1 行 = 原第 CM6_TRIM_KEEP_LINES 行，末行 = 刚追加的
    expect(state().doc.line(1).text).toBe(`L${CM6_TRIM_KEEP_LINES}`);
    expect(state().doc.line(expectedRemaining).text).toBe("tail");
  });

  it("裁剪不影响颜色装饰系统的可用性（裁剪后仍能继续追加并染色）", () => {
    const lines = Array.from({ length: CM6_MAX_DOC_LINES }, (_, i) => `L${i + 1}`);
    const { view, state } = makeView(lines.join("\n"));

    appendLineToView(view, "tail", "sent");
    appendLineToView(view, "after", "system");

    expect(state().doc.line(state().doc.lines).text).toBe("after");
    expect(Object.values(lineDecos(state()))).toContain("cm-line-system");
  });
});
