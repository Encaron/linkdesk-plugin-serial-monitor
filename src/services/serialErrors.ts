/**
 * 串口语义错误码——插件侧**唯一码表**（A 的 contract 补齐：openPort 错误码颗粒度）。
 *
 * 门外 AI 原来拿到的是壳兜底 `ESHELLERROR`（插件抛裸 `Error` ⇒ 池侧只能给笼统码），
 * 无法区分「没有口 / 设备打不开 / 参数错」。这里把串口语义收成一张稳定、可机读的码表，
 * 所有**预期内**的业务错误只经 `serialError()` 构造一次。
 *
 * 🔴 跨桥携带规则（2026-11-25 A 实测 / 池侧 S2-T14 根修）：
 *   · handler 是经 contextBridge 代理的页面世界函数——**异常跨桥只保留 message**，
 *     `code`/`hint`/`details` 自定义属性会被丢掉 ⇒ 池侧只能归 `EUNKNOWN`。
 *   · **返回值走结构化克隆，属性不丢** ⇒ 预期失败必须 **`return serialError(...)`**，
 *     ⛔ 不要 `throw`（`throw` 只留给真正的意外/编程错误，那类归 EUNKNOWN 是合理的）。
 *   · 返回形状 = `{ isPluginError: true, code, message, hint?, details? }`（普通对象，⛔ Error 实例——
 *     Error 的结构化克隆只带 name/message）。
 *
 * 分工：
 *   · `code` 机读（本表） · `message` 人读 · `hint` 下一步 · `details` 结构化上下文（英文键）
 *   · 壳保留码（EVIEWREQUIRED / ENOTACTIVE / EUNKNOWNCOMMAND / EOPEXPIRED / EPOLICYDENIED /
 *     EPROTECTED / EUSERDENIED / ESHELLTIMEOUT / EUNKNOWN）由壳产生，⛔ 插件不得重定义。
 */
import { pluginError } from "@linkdesk/plugin-sdk/runtime";

export const SERIAL_ERROR_CODES = {
  /** 没有可用端口，或点名的 portName 不存在 */
  ENOPORT: "ENOPORT",
  /** 端口存在但打不开（占用 / 掉线 / 权限 / 宿主无串口能力） */
  EDEVICE: "EDEVICE",
  /** 参数非法（baudRate / sessionId / 帧格式 / 必填缺失） */
  EBADARGS: "EBADARGS",
  /** 同口并发 query（已有等待中的请求） */
  EBUSY: "EBUSY",
  /** 端口没有绑定任何会话（reopen 无参数可恢复） */
  ENOSESSION: "ENOSESSION",
  /** 命名游标不存在 */
  ENOMARK: "ENOMARK",
  /** 发送失败（写口被拒） */
  ESENDFAIL: "ESENDFAIL",
} as const;

export type SerialErrorCode = (typeof SERIAL_ERROR_CODES)[keyof typeof SERIAL_ERROR_CODES];

/** 命令 handler 的**返回式**结构化错误（跨 contextBridge 可携带；池侧见 `isPluginError === true` 转 rejection）。 */
export interface SerialCommandError {
  readonly isPluginError: true;
  readonly code: SerialErrorCode;
  readonly message: string;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;
}

/**
 * 构造一条串口语义错误——**用 `return` 交给宿主**（⛔ `throw`：异常跨桥丢 code）。
 *
 * 入参形状仍先过 SDK `pluginError`（唯一校验面）；再摊成普通对象返回——Error 实例跨桥会丢自定义属性。
 */
export function serialError(
  code: SerialErrorCode,
  message: string,
  hint?: string,
  details?: Record<string, unknown>,
): SerialCommandError {
  const validated = pluginError({ code, message, hint, details });
  return {
    isPluginError: true,
    code: validated.code as SerialErrorCode,
    message: validated.message,
    ...(validated.hint !== undefined ? { hint: validated.hint } : {}),
    ...(validated.details !== undefined ? { details: validated.details } : {}),
  };
}
