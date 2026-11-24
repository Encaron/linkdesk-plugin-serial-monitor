/**
 * @vitest-environment jsdom
 * serialInbound（D1/D2）——插件侧唯一解码头。
 * 判据：拼行（分块/多行/空行）、100ms idle flush、会话级编码、自动档回退、tx 方向、
 *       HEX 来自原始字节（GBK/二进制不失真）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ensureSerialInboundSubscribed,
  subscribeSerialInbound,
  _resetSerialInbound,
  type SerialInboundLine,
} from "../services/serialInbound";
import { _store } from "../hooks/useSerialSessions/store";
import type { SerialSession } from "../hooks/useSerialSessions/types";

let dataCb: ((p: unknown) => void) | undefined;
let lines: SerialInboundLine[] = [];

function session(patch: Partial<SerialSession>): SerialSession {
  return {
    id: "s-demo", name: "demo", port: "COM3", baudRate: "115200",
    dataBits: 8, stopBits: 1, parity: "none", dtr: false, rts: false,
    hexAsciiDualPane: false, escapeInvisibleChars: false, autoSaveReceive: true, sendInitOnOpen: false,
    connected: false, timestampFormat: "HH:mm:ss:fff", showEcho: true,
    showLineNumbers: true, separateSystemLog: true, lineEnding: "\\r\\n",
    autoRepeat: false, repeatInterval: 1000, autoClear: false,
    receiveMode: "text", receiveCoding: "UTF-8", sendMode: "text", sendCoding: "UTF-8",
    quickSends: {}, color: "#fff", ...patch,
  };
}

beforeEach(() => {
  _resetSerialInbound();
  lines = [];
  _store.sessions = [];
  _store.activeSessionId = null;
  (window.linkdesk as unknown as Record<string, unknown>).serial = {
    onData: (cb: (p: unknown) => void) => { dataCb = cb; return () => { dataCb = undefined; }; },
    onSystem: () => () => {},
  };
  subscribeSerialInbound((l) => lines.push(l));
  expect(ensureSerialInboundSubscribed()).toBe(true);
});

afterEach(() => {
  vi.useRealTimers();
  _resetSerialInbound();
});

function feed(portName: string, bytes: Uint8Array, dir: "rx" | "tx" = "rx"): void {
  dataCb?.({ portName, dir, data: bytes, at: 1000 });
}

describe("拼行", () => {
  it("分块 + 多行 + 空行：按 \\n 成行，空行跳过", () => {
    feed("COM3", new TextEncoder().encode("he"));
    feed("COM3", new TextEncoder().encode("llo\n\nok\n"));

    expect(lines.map((l) => l.text)).toEqual(["hello", "ok"]);
    expect(lines[0].hex).toBe("68 65 6C 6C 6F"); // 行内容不含 \n
  });

  it("无 \\n：100ms idle flush 成行（对齐旧壳残留冲刷）", () => {
    vi.useFakeTimers();
    feed("COM3", new TextEncoder().encode("partial"));
    expect(lines).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(lines.map((l) => l.text)).toEqual(["partial"]);
  });

  it("UTF-8 多字节被分块：拼行后解码正确", () => {
    const zh = new TextEncoder().encode("中\n");
    feed("COM3", zh.subarray(0, 1));
    feed("COM3", zh.subarray(1));

    expect(lines[0].text).toBe("中");
    expect(lines[0].hex).toBe("E4 B8 AD");
  });
});

describe("编码", () => {
  it("会话级 GB2312 解码；HEX 来自原始字节", () => {
    _store.sessions = [session({ receiveCoding: "GB2312" })];
    _store.activeSessionId = "s-demo";
    feed("COM3", Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a]));

    expect(lines[0]).toMatchObject({ text: "中文", hex: "D6 D0 CE C4", dir: "rx" });
  });

  it("会话级 Shift-JIS 解码", () => {
    _store.sessions = [session({ receiveCoding: "Shift-JIS" })];
    _store.activeSessionId = "s-demo";
    feed("COM3", Uint8Array.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x0a]));

    expect(lines[0]).toMatchObject({ text: "テスト", hex: "83 65 83 58 83 67" });
  });

  it("Latin-1 是 1:1（不是 windows-1252）", () => {
    _store.sessions = [session({ receiveCoding: "Latin-1" })];
    _store.activeSessionId = "s-demo";
    feed("COM3", Uint8Array.from([0x80, 0xff, 0x0a]));

    expect(lines[0].text).toBe("\u0080\u00ff");
  });

  it("自动档：UTF-8 strict 失败 ⇒ 回退 GB2312", () => {
    _store.sessions = [session({ receiveCoding: "auto" })];
    _store.activeSessionId = "s-demo";
    feed("COM3", Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a]));

    expect(lines[0].text).toBe("中文");
  });

  it("二进制：0xFF 不崩，HEX 原样", () => {
    feed("COM3", Uint8Array.from([0xff, 0x41, 0x0a]));
    expect(lines[0].hex).toBe("FF 41");
    expect(lines[0].text.length).toBeGreaterThan(0);
  });
});

describe("方向", () => {
  it("tx：用发送编码解码，HEX 原样", () => {
    _store.sessions = [session({ sendCoding: "GB2312" })];
    _store.activeSessionId = "s-demo";
    feed("COM3", Uint8Array.from([0xd6, 0xd0]), "tx");

    expect(lines[0]).toMatchObject({ dir: "tx", text: "中", hex: "D6 D0" });
  });
});
