/**
 * text——接收区渲染期的两个纯函数（不可见字符转义 / 保存文件名消毒）。
 * 判据：C0 控制符与 DEL 的映射逐条、可打印字符不动、消毒的字符集与空串兜底。
 */
import { describe, it, expect } from "vitest";
import { escapeInvisible, sanitizeFileName } from "../utils/text";

describe("escapeInvisible", () => {
  it("TAB / LF / CR / DEL 走各自的可见符号", () => {
    expect(escapeInvisible("\t")).toBe("␉");
    expect(escapeInvisible("\n")).toBe("␊");
    expect(escapeInvisible("\r")).toBe("␍");
    expect(escapeInvisible("\x7F")).toBe("␡");
  });

  it("其余 C0 控制符走 Unicode Control Pictures（0x2400 + code）", () => {
    expect(escapeInvisible("\x00")).toBe("␀");
    expect(escapeInvisible("\x01")).toBe("␁");
    expect(escapeInvisible("\x1B")).toBe("␛"); // ESC
    expect(escapeInvisible("\x1F")).toBe("␟");
  });

  it("可打印字符原样保留（含空格、中文、大于 0x7F 的字符）", () => {
    expect(escapeInvisible("AT+OK 中文")).toBe("AT+OK 中文");
    expect(escapeInvisible("é")).toBe("é");
  });

  it("一条混合文本：控制符逐处替换，其余不动", () => {
    expect(escapeInvisible("A\r\nB\x00C")).toBe("A␍␊B␀C");
  });

  it("空串 → 空串", () => {
    expect(escapeInvisible("")).toBe("");
  });
});

describe("sanitizeFileName", () => {
  it("Windows 非法文件名字符逐条替换为下划线", () => {
    expect(sanitizeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("控制字符同样替换为下划线（防路径穿越 + 防非法名）", () => {
    expect(sanitizeFileName("a\x00b\nc")).toBe("a_b_c");
  });

  it("路径穿越串被拍平——斜杠与点不再构成目录跳转", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
  });

  it("首尾空白被 trim", () => {
    expect(sanitizeFileName("  rec  ")).toBe("rec");
  });

  it("清洗后为空 → 回落 \"serial\"（空文件名不可用）", () => {
    expect(sanitizeFileName("")).toBe("serial");
    expect(sanitizeFileName("   ")).toBe("serial");
    expect(sanitizeFileName("\x00\x01\x02")).toBe("___"); // 控制符 → "_"，清洗后**非空** ⇒ 不回落
  });

  it("全是非法字符时不会回落——因为已经被下划线占位（现状即契约）", () => {
    expect(sanitizeFileName("***")).toBe("___");
  });

  it("合法名原样返回（含点、连字符、中文）", () => {
    expect(sanitizeFileName("rec-2026.log")).toBe("rec-2026.log");
    expect(sanitizeFileName("接收记录")).toBe("接收记录");
  });
});
