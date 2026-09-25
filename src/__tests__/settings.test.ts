/**
 * settings（SerialMonitorView）——会话 → 视图设置的读取。
 * 判据：null-safe 兜底**逐字段**（字段缺失回落默认、空串**不**回落、显式 false/0 **不**回落）。
 * 这些默认值只服务本视图渲染与发送管道，不回写会话。
 */
import { describe, it, expect } from "vitest";
import type { SerialSession } from "../hooks/useSerialSessions";
import { cloneDefaults, SESSION_COLORS } from "../hooks/useSerialSessions/types";
import { readSettings } from "../views/SerialMonitorView/settings";

/** 完整会话（缺省值来自 cloneDefaults——避免与生产默认值手抄两份） */
function makeSession(patch: Partial<SerialSession> = {}): SerialSession {
  return { id: "s-demo", name: "demo", color: SESSION_COLORS[0], ...cloneDefaults(), ...patch };
}

/** 字段缺失的会话（模拟旧版本落盘的会话对象） */
function makePartialSession(partial: Record<string, unknown>): SerialSession {
  return partial as unknown as SerialSession;
}

describe("readSettings", () => {
  it("无活跃会话（null）→ 落到那一组默认值，逐字段对齐", () => {
    expect(readSettings(null)).toEqual({
      port: "",
      name: undefined,
      timestampFormat: "HH:mm:ss:fff",
      showEcho: true,
      showLineNumbers: true,
      separateSystemLog: true,
      lineEnding: "\\r\\n",
      autoRepeat: false,
      repeatInterval: 1000,
      autoClear: false,
      receiveMode: "text",
      receiveCoding: "UTF-8",
      sendMode: "text",
      sendCoding: "UTF-8",
      hexAsciiDualPane: false,
      escapeInvisibleChars: false,
      autoSaveReceive: true,
      // ⚠️ 两条默认值的**形态口径不同**（各自消费端不同，别「统一」成一种）：
      //   lineEnding 存**转义文本**（生产侧 useSendData 发送前才 `.replace(/\\r/g,"\r")` 还原）；
      //   quickSends 的值是**正文**（原文照发、不还原转义），换行由 handleQuickSend 追加 ⇒ 值里不带换行
      quickSends: { AT: "AT" },
      sendInitOnOpen: false,
    });
  });

  it("字段缺失（旧落盘对象）→ 缺的回落默认、在的照用", () => {
    const out = readSettings(makePartialSession({ id: "s-demo", name: "demo", port: "COM_TEST_1", showEcho: false }));

    expect(out.port).toBe("COM_TEST_1");
    expect(out.showEcho).toBe(false);
    // 未提供的字段一律回落
    expect(out.timestampFormat).toBe("HH:mm:ss:fff");
    expect(out.repeatInterval).toBe(1000);
    expect(out.sendInitOnOpen).toBe(false);
  });

  it("有值（完整会话）→ 逐字段照抄会话", () => {
    const out = readSettings(makeSession({
      port: "COM_TEST_2",
      name: "rec-demo",
      timestampFormat: "无",
      showEcho: false,
      showLineNumbers: false,
      separateSystemLog: false,
      lineEnding: "\\n",
      autoRepeat: true,
      repeatInterval: 250,
      autoClear: true,
      receiveMode: "hex",
      receiveCoding: "GBK",
      sendMode: "hex",
      sendCoding: "GBK",
      hexAsciiDualPane: true,
      escapeInvisibleChars: true,
      autoSaveReceive: false,
      quickSends: { PING: "PING\\r" },
      sendInitOnOpen: true,
    }));

    expect(out).toEqual({
      port: "COM_TEST_2",
      name: "rec-demo",
      timestampFormat: "无",
      showEcho: false,
      showLineNumbers: false,
      separateSystemLog: false,
      lineEnding: "\\n",
      autoRepeat: true,
      repeatInterval: 250,
      autoClear: true,
      receiveMode: "hex",
      receiveCoding: "GBK",
      sendMode: "hex",
      sendCoding: "GBK",
      hexAsciiDualPane: true,
      escapeInvisibleChars: true,
      autoSaveReceive: false,
      quickSends: { PING: "PING\\r" },
      sendInitOnOpen: true,
    });
  });

  it("空串**不**回落（`??` 语义）——空 port 是「走缺省唯一口语义」的合法值", () => {
    const out = readSettings(makeSession({ port: "", name: "", lineEnding: "", receiveMode: "", sendMode: "" }));

    expect(out.port).toBe("");
    expect(out.name).toBe("");
    expect(out.lineEnding).toBe("");
    expect(out.receiveMode).toBe("");
    expect(out.sendMode).toBe("");
  });

  it("显式 false / 0 不被回落（防 `||` 写回）", () => {
    const out = readSettings(makeSession({
      showEcho: false,
      showLineNumbers: false,
      separateSystemLog: false,
      autoRepeat: false,
      autoClear: false,
      autoSaveReceive: false,
      sendInitOnOpen: false,
      hexAsciiDualPane: false,
      escapeInvisibleChars: false,
      repeatInterval: 0,
    }));

    expect(out.showEcho).toBe(false);
    expect(out.showLineNumbers).toBe(false);
    expect(out.separateSystemLog).toBe(false);
    expect(out.autoRepeat).toBe(false);
    expect(out.autoClear).toBe(false);
    expect(out.autoSaveReceive).toBe(false);
    expect(out.sendInitOnOpen).toBe(false);
    expect(out.hexAsciiDualPane).toBe(false);
    expect(out.escapeInvisibleChars).toBe(false);
    expect(out.repeatInterval).toBe(0);
  });

  it("会话给了 quickSends 就原样透传（含空对象——合法表达「没有快捷发送」）", () => {
    expect(readSettings(makeSession({ quickSends: { PING: "PING" } })).quickSends).toEqual({ PING: "PING" });
    expect(readSettings(makeSession({ quickSends: {} })).quickSends).toEqual({});
  });

  it("缺省 quickSends 每次都是**新对象**（共享字面量会让两个会话互相串改）", () => {
    const a = readSettings(null).quickSends;
    const b = readSettings(null).quickSends;

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("无会话时 name 为 undefined（不是空串——「没名字」与「名字为空」在导出文件名上语义不同）", () => {
    expect(readSettings(null).name).toBeUndefined();
  });
});
