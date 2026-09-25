/**
 * pluginId——本插件自识 ID 常量。
 * 判据：取值稳定（广播事件 serial:storeChanged / plugin-state:changed 都按它过滤）、
 * 形态合规（硬约束 23 ②：pluginId 自身不得以 ldk- 开头）。
 */
import { describe, it, expect } from "vitest";
import { SERIAL_MONITOR_PLUGIN_ID } from "../utils/pluginId";

describe("SERIAL_MONITOR_PLUGIN_ID", () => {
  it("取值是 serial-monitor——发布后不可变，改了会静默丢掉自身事件过滤", () => {
    expect(SERIAL_MONITOR_PLUGIN_ID).toBe("serial-monitor");
  });

  it("形态合法：小写字母/数字/连字符", () => {
    expect(SERIAL_MONITOR_PLUGIN_ID).toMatch(/^[a-z0-9-]+$/);
  });

  it("不以宿主保留前缀 ldk- 开头（硬约束 23 ②）", () => {
    expect(SERIAL_MONITOR_PLUGIN_ID.startsWith("ldk-")).toBe(false);
  });
});
