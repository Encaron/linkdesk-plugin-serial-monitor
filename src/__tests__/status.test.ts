/**
 * status（SerialContext）——wire 状态与本地投影的合并。
 * 判据：**逐字段** null-safe（键缺失回落本地、键在场就用 wire，含 false / 空串这类「看起来像空」的值）。
 *
 * ⚠️ 类型面既有事实（本轮只登记不改）：`SerialStatusDto.baudRate` 是 `number`，而 `SerialState.baudRate`
 *    标的是 `string` ⇒ 合并后该字段运行期持有 number（本包 tsc 不进门禁，既有报错见交接段）。断言按**运行期**写。
 */
import { describe, it, expect } from "vitest";
import { mergeStatus } from "../services/SerialContext/status";
import type { SerialState, SerialStatusDto } from "../services/SerialContext/types";

function makeState(patch: Partial<SerialState> = {}): SerialState {
  return {
    ports: [{ name: "COM_TEST_1", description: "demo port" }],
    sourceName: "COM_TEST_1",
    baudRate: "115200",
    isOpen: false,
    lastError: null,
    ...patch,
  };
}

describe("mergeStatus", () => {
  it("wire 全字段在场 → 逐字段覆盖本地投影", () => {
    const prev = makeState({ sourceName: "COM_TEST_1", baudRate: "115200", isOpen: false, lastError: null });

    const out = mergeStatus(prev, { portName: "COM_TEST_2", baudRate: 9600, isOpen: true, lastError: "示错" });

    expect(out.sourceName).toBe("COM_TEST_2");
    expect(out.baudRate as unknown as number).toBe(9600);
    expect(out.isOpen).toBe(true);
    expect(out.lastError).toBe("示错");
  });

  it("wire 全缺（空对象）→ 四个字段全部回落本地值", () => {
    const prev = makeState({ sourceName: "COM_TEST_1", baudRate: "115200", isOpen: true, lastError: "旧错" });

    const out = mergeStatus(prev, {});

    expect(out.sourceName).toBe("COM_TEST_1");
    expect(out.baudRate).toBe("115200");
    expect(out.isOpen).toBe(true);
    expect(out.lastError).toBe("旧错");
  });

  it("wire 只给一两个字段 → 只覆盖那几个（其余回落）", () => {
    const prev = makeState({ isOpen: true, lastError: "旧错" });

    const out = mergeStatus(prev, { portName: "COM_TEST_2" });

    expect(out.sourceName).toBe("COM_TEST_2");
    expect(out.isOpen).toBe(true);
    expect(out.lastError).toBe("旧错");
    expect(out.baudRate).toBe("115200");
  });

  it("`isOpen: false` 是**有效值**不是缺省——必须覆盖本地的 true（`||` 写回会漏掉关闭态）", () => {
    const out = mergeStatus(makeState({ isOpen: true }), { isOpen: false });

    expect(out.isOpen).toBe(false);
  });

  it("`lastError: null` 回落本地（现状即契约）——wire 的 null 当「无此字段」，旧错误粘着不清", () => {
    const out = mergeStatus(makeState({ lastError: "旧错" }), { lastError: null });

    // ⚠️ 语义登记（交接段有案）：wire 带 lastError:null 不能清错——`??` 把 null 当缺省。
    //    实况是 lastError 只由 ipc.ts 写字符串、没有任何清空入口，故这里是「粘性」而非「清空」。
    expect(out.lastError).toBe("旧错");
  });

  it("本地 lastError 为 null、wire 不给 → 保持 null", () => {
    const out = mergeStatus(makeState({ lastError: null }), {});

    expect(out.lastError).toBeNull();
  });

  it("`lastError: \"\"` 空串照收（`??` 不会把空串当缺省）", () => {
    const out = mergeStatus(makeState({ lastError: "旧错" }), { lastError: "" });

    expect(out.lastError).toBe("");
  });

  it("本地非状态字段（ports 列表）原样保留——merge 只碰已知的四个字段", () => {
    const prev = makeState({ ports: [{ name: "COM_TEST_7", description: "another" }] });

    const out = mergeStatus(prev, { isOpen: true });

    expect(out.ports).toEqual([{ name: "COM_TEST_7", description: "another" }]);
  });

  it("返回新对象——不就地改 prev（投影是纯函数，调用方按引用比较）", () => {
    const prev = makeState();
    const out = mergeStatus(prev, { isOpen: true });

    expect(out).not.toBe(prev);
    expect(prev.isOpen).toBe(false);
  });

  it("历史 DTO 形态（多带未知字段）不炸、也不透传未知键", () => {
    const dto = { portName: "COM_TEST_1", baudRate: 57600, txBytes: 12, rxBytes: 34 } as SerialStatusDto;

    const out = mergeStatus(makeState(), dto);

    expect(out.baudRate as unknown as number).toBe(57600);
    expect(Object.keys(out).sort()).toEqual(["baudRate", "isOpen", "lastError", "ports", "sourceName"]);
  });
});
