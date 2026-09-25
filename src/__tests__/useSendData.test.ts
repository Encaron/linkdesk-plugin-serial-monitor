/**
 * @vitest-environment jsdom
 * useSendData——发送管道（替身层）。
 * 判据：HEX 解析与时间戳格式化的纯函数边界；`performSend` 的五步管道（history → 编码 → invoke → 回显 → 错误）
 *       逐条可证；`port || undefined` 的缺省口语义；`ending` 的**转义还原**；失败/静默两条错误路。
 *
 * 替身来源：`window.linkdesk.serial.sendText/sendData` 共享 mock 里**没有**（插件专属后门）⇒ 本文件就地 `vi.fn()`。
 * 时间用 `vi.setSystemTime` 钉死——回显文案里嵌了时间戳，不钉死就没法断言全文。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { formatTimestamp, hexToBytes, useSendData } from "../utils/useSendData";
import type { SendCallbacks, SendContext } from "../utils/useSendData";
import { DEFAULT_SESSION } from "../hooks/useSerialSessions/types";
import { readSettings } from "../views/SerialMonitorView/settings";

function stubSerial() {
  const sendText = vi.fn(() => Promise.resolve());
  const sendData = vi.fn(() => Promise.resolve());
  (window.linkdesk as unknown as { serial: unknown }).serial = { sendText, sendData };
  return { sendText, sendData };
}

/** 一套完整的发送环境（ctx/callbacks 走 ref —— 生产里也是 ref，改了不触发重渲染） */
function setup(ctxPatch: Partial<SendContext> = {}) {
  const serial = stubSerial();
  const ctx: SendContext = {
    sendMode: "text", sendCoding: "UTF-8", lineEnding: "\\r\\n", timestampFormat: "HH:mm:ss:fff", port: "",
    ...ctxPatch,
  };
  const cb: SendCallbacks = { onEcho: vi.fn(), onHistory: vi.fn(), onError: vi.fn() };
  const ctxRef = { current: ctx };
  const cbRef = { current: cb };
  const { result, rerender } = renderHook(() => useSendData(ctxRef, cbRef));
  return { serial, ctx, cb, ctxRef, cbRef, result, rerender };
}

beforeEach(() => {
  // ⚠️ `useFakeTimers({ now })` 一次给全——别用 `useFakeTimers()` ＋ `setSystemTime()` 两段式：
  //    后者会把定时器的到期时刻算在旧时钟基上（同仓 useReceiveStream.test.ts 踩过这个坑）。
  vi.useFakeTimers({ now: new Date(2026, 0, 2, 3, 4, 5, 6) });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window.linkdesk as unknown as { serial?: unknown }).serial;
});

describe("hexToBytes", () => {
  it("带分隔符 / 不带分隔符 / 混大小写都解析成同一串字节", () => {
    expect(Array.from(hexToBytes("48 65 6c"))).toEqual([0x48, 0x65, 0x6c]);
    expect(Array.from(hexToBytes("48656C"))).toEqual([0x48, 0x65, 0x6c]);
    expect(Array.from(hexToBytes("48-65:6C"))).toEqual([0x48, 0x65, 0x6c]);
  });

  it("奇数个字符 ⇒ 末位单字符也算一个字节（左对齐补零解析，不是丢弃）", () => {
    expect(Array.from(hexToBytes("ABC"))).toEqual([0xab, 0x0c]);
    expect(Array.from(hexToBytes("4"))).toEqual([0x04]);
  });

  it("空串 / 全非法字符 ⇒ 零字节目录（发送侧随后发的是空包，不是崩）", () => {
    expect(hexToBytes("")).toHaveLength(0);
    expect(hexToBytes("zz --")).toHaveLength(0);
    expect(Array.from(hexToBytes("0"))).toEqual([0x00]); // 半个字节 ⇒ 右补零
  });
});

describe("formatTimestamp", () => {
  it("\"HH:mm:ss:fff\" → 带毫秒（钉死系统时间后逐位可断）", () => {
    expect(formatTimestamp("HH:mm:ss:fff")).toBe("03:04:05:006");
  });

  it("其余格式（含 \"无\"）→ 只有到秒——时间戳前缀的两种形态由调用方自己选", () => {
    expect(formatTimestamp("HH:mm:ss")).toBe("03:04:05");
    expect(formatTimestamp("无")).toBe("03:04:05");
  });
});

describe("performSend · 文本模式", () => {
  it("空/纯空白 ⇒ 整条管道短路：不记历史、不发、不回显", async () => {
    const { serial, cb, result } = setup();

    await result.current.performSend("");
    await result.current.performSend("   ");

    expect(serial.sendText).not.toHaveBeenCalled();
    expect(cb.onHistory).not.toHaveBeenCalled();
    expect(cb.onEcho).not.toHaveBeenCalled();
  });

  it("正文 + 行尾：lineEnding 存的是**转义文本**，发送前才还原成真 CR/LF", async () => {
    const { serial, cb, result } = setup();

    await result.current.performSend("hi");

    expect(serial.sendText).toHaveBeenCalledWith("hi\r\n", "UTF-8", undefined);
    expect(cb.onEcho).toHaveBeenCalledWith('03:04:05:006 ---- 已发送 utf-8 编码消息: "hi" ----');
  });

  it("opts.ending 覆盖会话设置（同一条还原口径），opts.prefix 只影响回显显示", async () => {
    const { serial, cb, result } = setup();

    await result.current.performSend("hi", { ending: "\\n", prefix: "> " });

    expect(serial.sendText).toHaveBeenCalledWith("hi\n", "UTF-8", undefined);
    expect(cb.onEcho).toHaveBeenCalledWith('03:04:05:006 ---- 已发送 utf-8 编码消息: "> hi" ----');
  });

  it("会话口非空 → 定向该口；空串 → undefined（走缺省唯一口语义）", async () => {
    const { serial, result } = setup({ port: "COM_TEST_1" });

    await result.current.performSend("hi");

    expect(serial.sendText).toHaveBeenCalledWith("hi\r\n", "UTF-8", "COM_TEST_1");

    const empty = setup({ port: "" });
    await empty.result.current.performSend("hi");
    expect(empty.serial.sendText.mock.calls[0][2]).toBeUndefined();
  });

  it("历史记的是 trim 后的正文；noHistory 跳过记录但照发照回显", async () => {
    const { cb, result } = setup();

    await result.current.performSend("  hi  ");
    expect(cb.onHistory).toHaveBeenCalledWith("hi");

    await result.current.performSend("again", { noHistory: true });
    expect(cb.onHistory).toHaveBeenCalledTimes(1);
  });

  it("回显里的正文把控制符换成可见转义（一行的回显不许把日志撑成多行）", async () => {
    const { cb, result } = setup();

    await result.current.performSend("A\nB");

    expect(cb.onEcho).toHaveBeenCalledWith('03:04:05:006 ---- 已发送 utf-8 编码消息: "A\\nB" ----');
  });

  it("发送失败 ⇒ onError 带原因；silent ⇒ 连错都不报", async () => {
    const { serial, cb, result } = setup();
    serial.sendText.mockRejectedValueOnce(new Error("端口已关闭"));

    await result.current.performSend("hi");
    expect(cb.onError).toHaveBeenCalledWith("发送失败：端口已关闭");

    cb.onError = vi.fn();
    serial.sendText.mockRejectedValueOnce("非 Error 抛出");
    await result.current.performSend("hi", { silent: true });
    expect(cb.onError).not.toHaveBeenCalled();
  });
});

describe("performSend · HEX 模式", () => {
  it("正文按 HEX 解析后发字节数组，回显报字节数（不是字符数）", async () => {
    const { serial, cb, result } = setup({ sendMode: "hex" });

    await result.current.performSend("48 65 6C");

    expect(serial.sendData).toHaveBeenCalledWith([0x48, 0x65, 0x6c], undefined);
    expect(cb.onEcho).toHaveBeenCalledWith("03:04:05:006 ---- 已发送 HEX 消息 (3 字节) ----");
  });

  it("opts.showHexPreview ⇒ 追加一条缩进的原文预览（不截断时原样）", async () => {
    const { cb, result } = setup({ sendMode: "hex" });

    await result.current.performSend("48 65", { showHexPreview: true });

    expect(cb.onEcho).toHaveBeenLastCalledWith("    48 65");
  });

  it("预览超 80 字符 ⇒ 截到 80 + \"...\"（长 HEX 串不许灌满接收区）", async () => {
    const { cb, result } = setup({ sendMode: "hex" });
    const long = "A".repeat(100);

    await result.current.performSend(long, { showHexPreview: true });

    expect(cb.onEcho).toHaveBeenLastCalledWith("    " + "A".repeat(80) + "...");
  });

  it("HEX 模式也认 port 缺省口语义（空串 → undefined）", async () => {
    const { serial, result } = setup({ sendMode: "hex", port: "COM_TEST_2" });

    await result.current.performSend("41");

    expect(serial.sendData).toHaveBeenCalledWith([0x41], "COM_TEST_2");
  });
});

describe("快捷发送默认值 ⇒ 线上字节（补测修复的回归钉子）", () => {
  it("默认 AT 药丸走完整管道 ⇒ 线上恰好 AT + 一个 CRLF（值里不许自带换行，也不许是转义文本）", async () => {
    const { serial, result } = setup();

    await result.current.performSend(DEFAULT_SESSION.quickSends.AT, { ending: "\r\n", prefix: "> " });

    expect(serial.sendText).toHaveBeenCalledWith("AT\r\n", "UTF-8", undefined);
  });

  it("settings 的无会话兜底与 DEFAULT_SESSION 同值（两处默认值不许再分叉）", () => {
    expect(readSettings(null).quickSends).toEqual(DEFAULT_SESSION.quickSends);
  });
});

describe("performSend · 引用稳定性", () => {
  it("重渲染后 performSend 是同一个引用（deps 全走 ref ⇒ 不触发下游 effect 重跑）", () => {
    const { result, rerender } = setup();
    const first = result.current.performSend;

    rerender();

    expect(result.current.performSend).toBe(first);
  });
});
