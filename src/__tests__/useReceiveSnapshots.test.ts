/**
 * useReceiveSnapshots——合屏迁移快照的读回 / 落档（E5.8#30.14 方向 c）。
 *
 * 契约两头：
 *   mount  → 快照若在，逐条重放（CM6 行带原行色 / 双栏开才重放 HEX 栏 / ring 回填），**随即删掉快照**
 *            ⇒ 快照是一次性的，重复 mount 不会把历史放两遍；
 *   unmount→ 会话仍在才落档（会话已删不写，防泄漏），只写「环里真有货」的，且**与 CM6 侧已写的
 *            lines/hexLines 合并**而不是覆盖（React cleanup 逆序：本 hook 声明在接收区 mount 之后，
 *            故本 effect 的 cleanup 先跑，CM6 cleanup 读 prev 时能看到这里的 ring）。
 *
 * ⚠️ 本 hook 的**声明位置**本身就是契约（必须排在 useReceiveEditorMount 之后）——测试只能验「合并
 *    不会互相覆盖」这一半；顺序那一半靠 index.tsx 的调用次序 + 上面这段注释守。
 *
 * 桩全在本文件：`_receiveSnapshots`（真 Map，逐例清空）、`_store.sessions`（真 store，逐例清空）、
 * appendLine/appendToView 用 `vi.fn()`。ringBuffer 用**真 RingBuffer**——它就是要验的那个环。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { EditorView } from "@codemirror/view";
import { useReceiveSnapshots } from "../views/SerialMonitorView/useReceiveSnapshots";
import { _receiveSnapshots, type ReceiveSnapshot } from "../services/receiveSnapshots";
import { _store } from "../hooks/useSerialSessions/store";
import type { SerialSession } from "../hooks/useSerialSessions/types";
import { RingBuffer } from "../utils/RingBuffer";
import type { LineType, ReceiveItem } from "../types";

const item = (text: string, type: LineType = "received"): ReceiveItem => ({ text, type });

/** 会话表只被 `getSessionById` 用（比对 id）⇒ 这只喂最少的字段 */
function seedSession(id: string) {
  _store.sessions = [{ id } as SerialSession];
}

function setup(o: { sourceId?: string; dualPane?: boolean; withHexView?: boolean } = {}) {
  const cmView = { current: null as EditorView | null };
  const hexView = { current: o.withHexView === false ? null : ({} as EditorView) };
  const dualPaneRef = { current: o.dualPane ?? false };
  const ringBuffer = { current: new RingBuffer<ReceiveItem>(8) };
  const appendLine = vi.fn();
  const appendToView = vi.fn();

  // gen 变 ⇒ 回调换引用 ⇒ 恢复 effect 重跑（用来验「快照已删 ⇒ 重跑空转」）。
  // ref 三件套**建在 hook 外**、各 gen 复用同一对象——否则每次 render 都是新 ref，测的就不是那件事了。
  const props = (gen: number) => ({
    // `"sourceId" in o` 而不是 `o.sourceId === undefined`——后者分不清「没给」与「显式不给（per-tab 未绑定）」
    sourceId: "sourceId" in o ? o.sourceId : "s1",
    cmView,
    hexView,
    dualPaneRef,
    ringBuffer,
    appendLine: gen === 0 ? appendLine : (t: string, c: LineType) => appendLine(t, c),
    appendToView: gen === 0 ? appendToView : (v: EditorView | null, t: string, c: LineType) => appendToView(v, t, c),
  });

  const utils = renderHook(({ gen }: { gen: number }) => useReceiveSnapshots(props(gen)), {
    initialProps: { gen: 0 },
  });

  return {
    ...utils,
    hexView,
    ringBuffer,
    appendLine,
    appendToView,
    churn: () => {
      utils.rerender({ gen: 1 });
      utils.rerender({ gen: 0 });
    },
  };
}

const seed = (id: string, snap: Partial<ReceiveSnapshot>) =>
  _receiveSnapshots.set(id, { lines: [], hexLines: [], ring: [], ...snap });

beforeEach(() => {
  _receiveSnapshots.clear();
  _store.sessions = [];
});

describe("useReceiveSnapshots", () => {
  describe("mount 读回", () => {
    it("CM6 行逐条重放（带原行色），快照随即删除——一次性，不会重放两遍", () => {
      seed("s1", {
        lines: [
          { text: "l1", type: "received" },
          { text: "系统提示", type: "system" },
          { text: "AT", type: "sent" },
        ],
      });

      const { appendLine } = setup();

      expect(appendLine.mock.calls).toEqual([
        ["l1", "received"],
        ["系统提示", "system"],
        ["AT", "sent"],
      ]);
      expect(_receiveSnapshots.has("s1")).toBe(false);
    });

    it("双栏关 ⇒ HEX 行不重放（观众看不到那一栏，写了是白干活）", () => {
      seed("s1", { hexLines: [{ text: "68 69", type: "received" }] });

      const { appendToView } = setup({ dualPane: false, withHexView: true });

      expect(appendToView).not.toHaveBeenCalled();
    });

    it("双栏开但 HEX 栏 view 还没就位 ⇒ 也不重放（不许往 null 里写）", () => {
      seed("s1", { hexLines: [{ text: "68 69", type: "received" }] });

      const { appendToView } = setup({ dualPane: true, withHexView: false });

      expect(appendToView).not.toHaveBeenCalled();
    });

    it("双栏开 + HEX 栏就位 ⇒ HEX 行也逐条重放，落到 HEX 的那份 view 上（与 ASCII 栏同源同色）", () => {
      seed("s1", {
        hexLines: [
          { text: "68 69", type: "received" },
          { text: "41 54", type: "sent" },
        ],
      });

      const { appendToView, hexView } = setup({ dualPane: true, withHexView: true });

      expect(appendToView.mock.calls).toEqual([
        [hexView.current, "68 69", "received"],
        [hexView.current, "41 54", "sent"],
      ]);
    });

    it("ring 逐条 write 回环——顺序与条目不丢，后续 IPC 数据接着排", () => {
      const a = item("a");
      const b = item("b", "sent");
      seed("s1", { ring: [a, b] });

      const { ringBuffer } = setup();

      expect(ringBuffer.current.size).toBe(2);
      expect(ringBuffer.current.drainAll()).toEqual([a, b]);
    });

    it("无 sourceId（per-tab 未绑定）⇒ 空转：不重放、快照也不删（留给别的 tab 去读）", () => {
      seed("s1", { lines: [{ text: "l1", type: "received" }] });

      const { appendLine } = setup({ sourceId: undefined });

      expect(appendLine).not.toHaveBeenCalled();
      expect(_receiveSnapshots.has("s1")).toBe(true);
    });

    it("没快照（平时状态）⇒ 空转", () => {
      const { appendLine, appendToView } = setup({ dualPane: true, withHexView: true });

      expect(appendLine).not.toHaveBeenCalled();
      expect(appendToView).not.toHaveBeenCalled();
    });

    it("重跑（deps 换引用）也安全：快照已删 ⇒ 不会把历史放第二遍", () => {
      seed("s1", { lines: [{ text: "l1", type: "received" }] });

      const { appendLine, churn } = setup();

      churn();

      expect(appendLine).toHaveBeenCalledTimes(1);
      expect(appendLine.mock.calls[0]).toEqual(["l1", "received"]);
    });
  });

  describe("unmount 落档", () => {
    it("会话仍在 + 环里有货 ⇒ 落档并 drainAll 取走（环清空，下次接收从零起）", () => {
      seedSession("s1");
      const { ringBuffer, unmount } = setup();

      ringBuffer.current.write(item("a"));
      ringBuffer.current.write(item("b"));
      unmount();

      expect(_receiveSnapshots.get("s1")!.ring.map((x) => x.text)).toEqual(["a", "b"]);
      expect(ringBuffer.current.size).toBe(0);
    });

    it("会话已被删 ⇒ 不落档（已删会话的快照没人来读，写了就是泄漏）", () => {
      // 不 seedSession —— store 里没有 s1
      const { ringBuffer, unmount } = setup();

      ringBuffer.current.write(item("a"));
      unmount();

      expect(_receiveSnapshots.has("s1")).toBe(false);
      expect(ringBuffer.current.size).toBe(1); // 也没白取走数据
    });

    it("环是空的 ⇒ 不落档（不留空壳快照去骗下次 mount）", () => {
      seedSession("s1");
      const { unmount } = setup();

      unmount();

      expect(_receiveSnapshots.has("s1")).toBe(false);
    });

    it("无 sourceId ⇒ 不落档", () => {
      const { ringBuffer, unmount } = setup({ sourceId: undefined });

      ringBuffer.current.write(item("a"));
      unmount();

      expect(_receiveSnapshots.size).toBe(0);
    });

    it("与 CM6 侧的落档**合并**（React cleanup 逆序）：本 hook 先只写 ring、CM6 随后补 lines，两份都在", () => {
      seedSession("s1");
      const { ringBuffer, unmount } = setup();

      ringBuffer.current.write(item("环里的"));
      unmount(); // ① 本 hook 的 cleanup 先跑：写 ring，lines/hexLines 留空位

      const mine = _receiveSnapshots.get("s1")!;
      expect(mine.ring.map((x) => x.text)).toEqual(["环里的"]);
      expect(mine.lines).toEqual([]);
      expect(mine.hexLines).toEqual([]);

      // ② 接收区 CM6 的 cleanup 随后跑（照 useReceiveEditorMount 的合并写法：补行、保留 prev.ring）
      const prev = _receiveSnapshots.get("s1");
      _receiveSnapshots.set("s1", {
        lines: [{ text: "CM6 行", type: "received" }],
        hexLines: [{ text: "43 4D 36", type: "received" }],
        ring: prev?.ring ?? [],
      });

      const merged = _receiveSnapshots.get("s1")!;
      expect(merged.lines).toEqual([{ text: "CM6 行", type: "received" }]);
      expect(merged.hexLines).toEqual([{ text: "43 4D 36", type: "received" }]);
      expect(merged.ring.map((x) => x.text)).toEqual(["环里的"]); // 先写的那份没被后写的盖掉
    });

    it("重挂读回上一轮的 ring，再卸载时是「补上这一轮新收的」——往返不丢数据", () => {
      seedSession("s1");

      const first = setup();
      first.ringBuffer.current.write(item("第一批"));
      first.unmount();

      const second = setup();
      expect(second.ringBuffer.current.size).toBe(1); // 上一轮的在环里回来了
      second.ringBuffer.current.write(item("第二批"));
      second.unmount();

      expect(_receiveSnapshots.get("s1")!.ring.map((x) => x.text)).toEqual(["第一批", "第二批"]);
    });
  });
});
