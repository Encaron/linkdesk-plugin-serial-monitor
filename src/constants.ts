/**
 * 串口监视器常量群——E6#87b 从 src/index.tsx 搬出（只搬不改）。
 * 缓存容量 / 模式 / 编辑器高度——跨接收区、发送栏、命令桥共享的单点真相源。
 */

export const SCROLL_AT_BOTTOM_TOLERANCE = 5;
export const BACK_TO_BOTTOM_THRESHOLD = 30;
export const SYSTEM_LOG_MAX_LINES = 50;
export const CM6_MAX_DOC_LINES = 2000;
export const CM6_TRIM_KEEP_LINES = 500;
export const RING_BUFFER_CAPACITY = 512;
export const PAUSED_BUFFER_MAX = 2000;
export const SEND_HISTORY_MAX = 20;
/** 接收日志（`AI#64` 拉取式命令的留存窗）容量——与 `PAUSED_BUFFER_MAX` 同量级：那是「界面重放」
 *  的上限，这是「AI 回读」的上限，两个数各自独立（一个是显示缓冲、一个是读数窗口，⛔ 别合并成一个）。 */
export const RECEIVE_LOG_MAX = 2000;
/** `readSince` 缺省取几条 / 单次上限——上限防「一条命令拉走整个缓冲」把回执撑爆（AI 应循环拉）。 */
export const RECEIVE_READ_LIMIT_DEFAULT = 200;
export const RECEIVE_READ_LIMIT_MAX = 1000;
export const HEX_WARNING_MAX_CHARS = 5;
export const SEND_EDITOR_MAX_HEIGHT = 80;
export const SEND_EDITOR_MIN_HEIGHT = 32;
// E5.7 Bug C 补全：发送模式字面量提为常量——规避自定义 ESLint 规则
// （BinaryExpression > Literal 小写字面量全量拦截）+ 单点真相源
export const SEND_MODE_TEXT = "text";
export const SEND_MODE_HEX = "hex";

/* ── 05 案（门外 AI 契约补齐）常量——A/B/C/E 组共用的数值单点 ── */
/** `reopen`（A-4）关 → 开之间的间隔（等驱动释放句柄） */
export const REOPEN_GAP_MS = 200;
/** `untilRegex` / `query`（C-3/C-4）服务端阻塞等待的轮询间隔 */
export const WAIT_POLL_MS = 50;
/** 等待循环每多少个 tick 查一次设备在场（≈500ms）——等待中拔线要立即结束（03 E19），但不必每 tick 都查 */
export const WAIT_DEVICE_CHECK_TICKS = 10;
/** 等待类参数 `timeoutMs` 上限（⛔ 不设无限等——命令层超时必须大于它，meta 里写明关系） */
export const WAIT_TIMEOUT_MS_MAX = 60000;
/** `reset`（E-1）缺省/上限拉低时长 */
export const RESET_HOLD_MS_DEFAULT = 100;
export const RESET_HOLD_MS_MAX = 5000;
/** `reset` 的 method 取值（单点真相源，命令校验与声明面同一份措辞） */
export const RESET_METHOD_DTR = "dtr";
export const RESET_METHOD_RTS = "rts";
export const RESET_METHOD_BOTH = "both";

/** 收发编码可选集——**单点真相源**：D2 起从 `@linkdesk/plugin-sdk/runtime` 取（共享清单），
 *  ⛔ 本插件不再抄第二份。接收/发送下拉与命令面 `serial-monitor.setSendCoding` 的取值校验都读这一份。 */
export { SERIAL_CODINGS } from "@linkdesk/plugin-sdk/runtime";
