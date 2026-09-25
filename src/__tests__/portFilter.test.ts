/**
 * portFilter——端口键控过滤三态（多口并发下「各收各的」的唯一判据）。
 * 无 key → 收（旧数据/单口兜底）· 本会话未配口 → 滤 · 不匹配 → 滤 · 匹配 → 收。
 */
import { describe, it, expect } from "vitest";
import { matchesPort } from "../utils/portFilter";

describe("matchesPort", () => {
  it("payload 无 portName（旧数据/单口）→ 收，且与会话口无关", () => {
    expect(matchesPort(undefined, "COM_TEST_1")).toBe(true);
    expect(matchesPort(undefined, null)).toBe(true);
    expect(matchesPort("", null)).toBe(true);
  });

  it("payload 有口名、本会话未配口（null）→ 一律滤", () => {
    expect(matchesPort("COM_TEST_1", null)).toBe(false);
  });

  it("payload 有口名、本会话配了口 → 完全相等才收", () => {
    expect(matchesPort("COM_TEST_1", "COM_TEST_1")).toBe(true);
    expect(matchesPort("COM_TEST_2", "COM_TEST_1")).toBe(false);
  });

  it("大小写不归一——COM_TEST_1 与本会话 com_test_1 视为不同口（现状即契约）", () => {
    expect(matchesPort("COM_TEST_1", "com_test_1")).toBe(false);
  });

  it("三态表驱动：payload × 会话口 的九种组合", () => {
    const cases: Array<[string | undefined, string | null, boolean]> = [
      [undefined, null, true],
      [undefined, "", true],
      [undefined, "COM_TEST_1", true],
      ["", null, true],
      ["", "", true],
      ["", "COM_TEST_1", true],
      ["COM_TEST_1", null, false],
      ["COM_TEST_1", "", false],
      ["COM_TEST_1", "COM_TEST_1", true],
      ["COM_TEST_1", "COM_TEST_2", false],
    ];

    for (const [payloadPort, sessionPort, expected] of cases) {
      expect(matchesPort(payloadPort, sessionPort), `${payloadPort} vs ${sessionPort}`).toBe(expected);
    }
  });
});
