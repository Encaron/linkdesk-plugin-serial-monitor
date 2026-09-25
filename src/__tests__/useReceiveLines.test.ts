/**
 * useReceiveLines——接收区写行路由（替身层）。
 * 判据：双栏/单栏的**路由**逐条——sent 受回显开关管、system 受独立日志开关管（且只进一处）、
 *       received 按 receiveMode 选形态 + 转义只作用于 received；HEX 栏与主栏逐行对齐。
 *
 * ⚠️ 反射断言口径：CM6 用**真 EditorState**，view 只造「dispatch 即 state.update」的最小外壳
 *    （⛔ 不建真视口、⛔ 不碰 DOM）——与 appendLine.test.ts 同一套外壳语义。
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { lineDecoField } from "../cm6/decorations";
import { useReceiveLines } from "../views/SerialMonitorView/useReceiveLines";
import { SYSTEM_LOG_MAX_LINES } from "../constants";
import type { ReceiveItem } from "../types";

type Spec = Parameters<EditorState["update"]>[0];

function makeView(doc = "") {
  let state = EditorState.create({ doc, extensions: [lineDecoField] });
  const view = {
    get state() { return state; },
    dispatch(spec: Spec) { state = state.update(spec).state; },
  } as unknown as EditorView;
  return {
    view,
    doc: () => state.doc.toString(),
    /** 行首 → 类名 */
    decos: () => {
      const out: Record<number, string> = {};
      state.field(lineDecoField).between(0, state.doc.length, (from, _to, d) => { out[from] = String(d.spec?.class ?? ""); });
      return out;
    },
  };
}

type Opts = Parameters<typeof useReceiveLines>[0];

function setup(patch: Partial<Omit<Opts, "cmView" | "hexView">> = {}) {
  const cm = makeView();
  const hex = makeView();
  const opts: Opts = {
    cmView: { current: cm.view },
    hexView: { current: hex.view },
    showEcho: true,
    separateSystemLog: true,
    setSystemLog: vi.fn(),
    receiveModeRef: { current: "text" },
    escapeRef: { current: false },
    dualPaneRef: { current: false },
    ...patch,
  };
  const { result } = renderHook(() => useReceiveLines(opts));
  return { cm, hex, opts, result };
}

function item(text: string, type: ReceiveItem["type"], hex?: string): ReceiveItem {
  return hex === undefined ? { text, type } : { text, hex, type };
}

describe("appendLine（主栏路由）", () => {
  it("received → 直接进主栏，类名 cm-line-received", () => {
    const { cm, result } = setup();

    result.current.appendLine("hello", "received");

    expect(cm.doc()).toBe("hello");
    expect(cm.decos()).toEqual({ 0: "cm-line-received" });
  });

  it("sent + 回显关 → 一个字都不写（不是写了再藏）", () => {
    const { cm, result } = setup({ showEcho: false });

    result.current.appendLine("sent line", "sent");

    expect(cm.doc()).toBe("");
    expect(cm.decos()).toEqual({});

    const on = setup({ showEcho: true });
    on.result.current.appendLine("sent line", "sent");
    expect(on.cm.decos()).toEqual({ 0: "cm-line-sent" });
  });

  it("system + 独立日志开 → 进 React 日志、**不进** CM6（一处一次，不重复显示）", () => {
    const { cm, opts, result } = setup({ separateSystemLog: true });

    result.current.appendLine("sys line", "system");

    expect(cm.doc()).toBe("");
    const updater = (opts.setSystemLog as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(updater(["old"])).toEqual(["old", "sys line"]);
  });

  it("独立日志超 SYSTEM_LOG_MAX_LINES 条 → 挤掉最老的（日志不会无限长）", () => {
    const { opts, result } = setup({ separateSystemLog: true });
    const full = Array.from({ length: SYSTEM_LOG_MAX_LINES }, (_, i) => `old${i}`);

    result.current.appendLine("newest", "system");
    const next = (opts.setSystemLog as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0](full);

    expect(next).toHaveLength(SYSTEM_LOG_MAX_LINES);
    expect(next[0]).toBe("old1");
    expect(next.at(-1)).toBe("newest");
  });

  it("system + 独立日志关 → 走主栏（关掉独立日志不是把系统消息丢了）", () => {
    const { cm, opts, result } = setup({ separateSystemLog: false });

    result.current.appendLine("sys line", "system");

    expect(opts.setSystemLog).not.toHaveBeenCalled();
    expect(cm.doc()).toBe("sys line");
    expect(cm.decos()).toEqual({ 0: "cm-line-system" });
  });

  it("视图还没 mount（null）→ 静默丢弃，不抛（CM6 未就绪时到达的数据）", () => {
    const { result } = setup({ cmView: { current: null } });

    expect(() => result.current.appendLine("hello", "received")).not.toThrow();
  });
});

describe("appendHexLine（HEX 栏路由）", () => {
  it("received → 用 hex 形态；hex 缺省时回落 text", () => {
    const { hex, result } = setup();

    result.current.appendHexLine(item("ascii", "received", "61 62"));
    expect(hex.doc()).toBe("61 62");

    const two = setup();
    two.result.current.appendHexLine(item("ascii", "received"));
    expect(two.hex.doc()).toBe("ascii");
  });

  it("sent 的回显开关与 system 的独立日志开关，在 HEX 栏**同口径**（两栏不许一行对齐一行不对齐）", () => {
    const off = setup({ showEcho: false });
    off.result.current.appendHexLine(item("sent", "sent"));
    expect(off.hex.doc()).toBe("");

    const sys = setup({ separateSystemLog: true });
    sys.result.current.appendHexLine(item("sys", "system"));
    expect(sys.hex.doc()).toBe("");

    const sysInline = setup({ separateSystemLog: false });
    sysInline.result.current.appendHexLine(item("sys", "system"));
    expect(sysInline.hex.doc()).toBe("sys");
  });

  it("HEX 栏的行色与主栏一致（同 type 同 cm-line-<色>）", () => {
    const { hex, result } = setup();

    result.current.appendHexLine(item("ascii", "received", "61"));
    result.current.appendHexLine(item("sent", "sent"));

    expect(hex.decos()).toEqual({ 0: "cm-line-received", 3: "cm-line-sent" });
  });
});

describe("renderLine（单栏/双栏合一）", () => {
  it("received + receiveMode=hex 且带 hex ⇒ 主栏画 HEX 形态", () => {
    const { cm, result } = setup({ receiveModeRef: { current: "hex" } });

    result.current.renderLine(item("AB", "received", "41 42"));

    expect(cm.doc()).toBe("41 42");
    expect(cm.decos()).toEqual({ 0: "cm-line-received" });
  });

  it("received + receiveMode=hex 但**没有** hex 形态 ⇒ 回落文本路（不画空行）", () => {
    const { cm, result } = setup({ receiveModeRef: { current: "hex" } });

    result.current.renderLine(item("AB", "received"));

    expect(cm.doc()).toBe("AB");
  });

  it("转义只作用于 received（sent/system 原样——它们是本机产生的中文文案）", () => {
    const escaped = setup({ escapeRef: { current: true } });
    escaped.result.current.renderLine(item("A\r\nB", "received"));
    expect(escaped.cm.doc()).toBe("A␍␊B"); // 转义后仍在**一行**里
    expect(escaped.cm.view.state.doc.lines).toBe(1);

    const raw = setup({ escapeRef: { current: true } });
    raw.result.current.renderLine(item("A\r\nB", "sent"));
    // 没转义 = 真换行原样交给 CM6 ⇒ 它按行拆开（CM6 把 CRLF 归一成 LF）
    expect(raw.cm.view.state.doc.lines).toBe(2);
    expect(raw.cm.doc()).toBe("A\nB");
    expect(raw.cm.doc()).not.toContain("␍");
  });

  it("双栏关 ⇒ HEX 栏一个字都不写；双栏开 ⇒ 两栏同步、行色相同", () => {
    const single = setup({ dualPaneRef: { current: false } });
    single.result.current.renderLine(item("AB", "received", "41 42"));
    expect(single.hex.doc()).toBe("");

    const dual = setup({ dualPaneRef: { current: true } });
    dual.result.current.renderLine(item("AB", "received", "41 42"));
    expect(dual.cm.doc()).toBe("AB"); // 文本栏按 receiveMode=text 走正文
    expect(dual.hex.doc()).toBe("41 42");
    expect(dual.hex.decos()).toEqual({ 0: "cm-line-received" });
  });

  it("双栏开 + system 独立日志开 ⇒ 只在 React 日志里，HEX 栏不镜像", () => {
    const { cm, hex, result } = setup({ dualPaneRef: { current: true }, separateSystemLog: true });

    result.current.renderLine(item("sys", "system"));

    expect(cm.doc()).toBe("");
    expect(hex.doc()).toBe("");
  });
});
