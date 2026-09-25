/**
 * @vitest-environment jsdom
 * saveFile——浏览器原生 File System Access API 的最小面。
 * 判据：API 缺失 ⇒ undefined（调用方据此走 Blob 兜底）；API 在场 ⇒ 取到的函数**绑定到 window**
 * （`.bind(window)` 掉了会让 picker 调用时的 this 丢失 → 原生实现抛 Illegal invocation）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SaveFilePickerWindow } from "../utils/saveFile";

/** 测试窗口上的 picker 桩——按需安装（必须在 import 之前，模块体在导入时求值） */
function setPicker(impl?: (this: unknown, opts: unknown) => Promise<{ tag: string }>): void {
  const w = window as unknown as SaveFilePickerWindow;
  if (impl) w.showSaveFilePicker = impl as unknown as SaveFilePickerWindow["showSaveFilePicker"];
  else delete (w as { showSaveFilePicker?: unknown }).showSaveFilePicker;
}

describe("saveFilePicker", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setPicker();
  });

  it("API 缺失 → saveFilePicker 为 undefined（调用方据此抛错 → catch 走 Blob 兜底）", async () => {
    setPicker();

    const mod = await import("../utils/saveFile");

    expect(mod.saveFilePicker).toBeUndefined();
  });

  it("API 在场 → 取到函数且已绑定 window", async () => {
    let seenThis: unknown;
    const showSaveFilePicker = vi.fn(function (this: unknown, _opts: unknown) {
      seenThis = this;
      return Promise.resolve({ tag: "handle" });
    });
    setPicker(showSaveFilePicker as unknown as (this: unknown, opts: unknown) => Promise<{ tag: string }>);

    const mod = await import("../utils/saveFile");

    expect(typeof mod.saveFilePicker).toBe("function");
    const handle = await mod.saveFilePicker!({ suggestedName: "rec-demo" });
    expect(handle).toEqual({ tag: "handle" });
    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: "rec-demo" });
    expect(seenThis).toBe(window);
  });

  it("模块体求值时取一次——之后替换 window 上的 API 不再影响已导出的引用", async () => {
    const first = vi.fn(() => Promise.resolve({ tag: "first" }));
    setPicker(first as unknown as (this: unknown, opts: unknown) => Promise<{ tag: string }>);

    const mod = await import("../utils/saveFile");
    const replacement = vi.fn(() => Promise.resolve({ tag: "second" }));
    setPicker(replacement as unknown as (this: unknown, opts: unknown) => Promise<{ tag: string }>);

    await expect(mod.saveFilePicker!({})).resolves.toEqual({ tag: "first" });
    expect(replacement).not.toHaveBeenCalled();
  });
});
