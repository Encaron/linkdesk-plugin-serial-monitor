/**
 * `serialErrors.ts` 单测——码表 ＋ 唯一构造点。
 *
 * 判据只钉契约（`isPluginError`/code/message/hint/details 原样可跨桥携带），⛔ 不钉实现细节；
 * 保留码/裸 Error 的拦截属于 SDK ESLint 腿（`check-error-envelope`），不在这里重复。
 */
import { describe, expect, it } from "vitest";
import { SERIAL_ERROR_CODES, serialError } from "../services/serialErrors";

describe("串口语义错误码", () => {
  it("码表语义稳定（A 契约：ENOPORT/EDEVICE/EBADARGS/EBUSY 四码必需）", () => {
    expect(SERIAL_ERROR_CODES.ENOPORT).toBe("ENOPORT");
    expect(SERIAL_ERROR_CODES.EDEVICE).toBe("EDEVICE");
    expect(SERIAL_ERROR_CODES.EBADARGS).toBe("EBADARGS");
    expect(SERIAL_ERROR_CODES.EBUSY).toBe("EBUSY");
  });

  it("serialError 返回可跨桥的普通对象信封（⛔ Error 实例——跨桥会丢自定义属性）", () => {
    const err = serialError(
      SERIAL_ERROR_CODES.EDEVICE,
      "打不开串口 COM3：Access denied",
      "先 serial-monitor.listPorts 核对",
      { portName: "COM3" },
    );
    expect(err).not.toBeInstanceOf(Error);
    expect(err.isPluginError).toBe(true);
    expect(err.code).toBe("EDEVICE");
    expect(err.message).toMatch(/COM3/);
    expect(err.hint).toMatch(/listPorts/);
    expect(err.details).toEqual({ portName: "COM3" });
    // 结构化克隆一圈也不丢（模拟 contextBridge 返回值）
    expect(structuredClone(err)).toEqual(err);
  });

  it("入参写错仍当场失败（编程错误不是业务回执）", () => {
    expect(() => serialError("" as never, "x")).toThrow(TypeError);
    expect(() => serialError(SERIAL_ERROR_CODES.EBADARGS, "")).toThrow(TypeError);
  });
});
