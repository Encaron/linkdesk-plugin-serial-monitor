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

/** 收发编码可选集——**单点真相源**：侧栏「收发设置」两个下拉（接收/发送编码）与命令面
 *  `serial-monitor.setSendCoding` 的取值校验都读这一份（⛔ 别再写第二份数组：
 *  两处一旦分叉，「命令设得进、下拉选不出」就是新的不一致）。 */
export const SERIAL_CODINGS = ["UTF-8", "GB2312", "Shift-JIS", "Latin-1"];
