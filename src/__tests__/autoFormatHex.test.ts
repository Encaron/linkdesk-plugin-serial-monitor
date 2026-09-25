/**
 * autoFormatHex——HEX 输入自动格式化（工厂注入 t，保持 i18n 同源）。
 * 判据：非法字符剔除 / 每两字符插空格 / 大小写归一 / 非法字符摘要（去重 + 长度截断）。
 * t 用**假函数**——⛔ 不引真字典（本层口径）。
 */
import { describe, it, expect, vi } from "vitest";
import { makeAutoFormatHex } from "../views/SerialMonitorView/autoFormatHex";
import { HEX_WARNING_MAX_CHARS } from "../constants";

/** 假 t——把 key 与插值参数一起拼出来，便于同时断言「key 对不对」与「参数对不对」 */
function makeFakeT() {
  return vi.fn((key: string, opts?: Record<string, unknown>) =>
    opts?.chars === undefined ? key : `${key}::${String(opts.chars)}`);
}

describe("makeAutoFormatHex", () => {
  it("合法输入：去掉空白后每两字符插一个空格，并统一大写", () => {
    const format = makeAutoFormatHex(makeFakeT());

    expect(format("ab cd").formatted).toBe("AB CD");
    expect(format("ABCDEF").formatted).toBe("AB CD EF");
  });

  it("非法字符被剔除，但不影响合法部分的成对分组", () => {
    const format = makeAutoFormatHex(makeFakeT());

    expect(format("A!B@C#D").formatted).toBe("AB CD");
  });

  it("空格与已有分组先归一再重排（「A B」与「AB」等价）", () => {
    const format = makeAutoFormatHex(makeFakeT());

    expect(format("A  B").formatted).toBe("AB");
    expect(format("A B C").formatted).toBe("AB C");
  });

  it("奇数个合法字符：最后一位单独成组，不补 0", () => {
    const format = makeAutoFormatHex(makeFakeT());

    expect(format("ABC").formatted).toBe("AB C");
  });

  it("无非法字符时不产出提示，且 t 一次都不被调用", () => {
    const t = makeFakeT();
    const format = makeAutoFormatHex(t);

    const out = format("AB CD");
    expect(out.warning).toBe("");
    expect(t).not.toHaveBeenCalled();
  });

  it("非法字符去重后拼进提示文案（同一字符只报一次）", () => {
    const t = makeFakeT();
    const format = makeAutoFormatHex(t);

    const out = format("A!!B??");
    expect(t).toHaveBeenCalledWith("⚠ HEX 输入包含无效字符: {{chars}}", { chars: "! ?" });
    expect(out.warning).toBe("⚠ HEX 输入包含无效字符: {{chars}}::! ?");
  });

  it("非法字符种类超过上限时截断到 HEX_WARNING_MAX_CHARS 种", () => {
    const t = makeFakeT();
    const format = makeAutoFormatHex(t);
    const extra = "!@#$%^&".split(""); // 7 种 > 上限

    const out = format(extra.join(""));

    const expected = extra.slice(0, HEX_WARNING_MAX_CHARS).join(" ");
    expect(t).toHaveBeenCalledWith("⚠ HEX 输入包含无效字符: {{chars}}", { chars: expected });
    expect(out.warning.endsWith(`::${expected}`)).toBe(true);
  });

  it("空串：格式化为空串、无提示", () => {
    const t = makeFakeT();
    const out = makeAutoFormatHex(t)("");

    expect(out).toEqual({ formatted: "", warning: "" });
    expect(t).not.toHaveBeenCalled();
  });

  it("全非法输入：格式化结果为空，但提示照报（用户要知道自己打的字符被丢了）", () => {
    const t = makeFakeT();
    const out = makeAutoFormatHex(t)("!@#");

    expect(out.formatted).toBe("");
    expect(out.warning).not.toBe("");
  });

  it("工厂是幂等的纯函数：同一输入多次调用结果相同", () => {
    const format = makeAutoFormatHex(makeFakeT());

    expect(format("ab!")).toEqual(format("ab!"));
  });
});
