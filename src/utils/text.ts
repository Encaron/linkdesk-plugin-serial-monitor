/**
 * 文本处理纯函数——E6#87b 从 src/index.tsx 搬出（只搬不改）。
 */

/** E5.8#30.19b：不可见字符 → 可见符号（Unicode Control Pictures，␀-␟/␡/␉/␊/␍）。
 *  渲染时转义，原始数据不动（导出/过滤/快照仍走原始文本）。 */
export function escapeInvisible(s: string): string {
  return s.replace(/[\x00-\x1F\x7F]/g, (c) => {
    const code = c.charCodeAt(0);
    if (code === 0x09) return "␉"; // TAB
    if (code === 0x0A) return "␊"; // LF
    if (code === 0x0D) return "␍"; // CR
    if (code === 0x7F) return "␡"; // DEL
    return String.fromCharCode(0x2400 + code); // 其余 C0 控制符
  });
}

/**
 * 原始字节 → 十六进制显示串——D1 起 HEX 的**唯一来源**（壳给字节，插件不再从文本反推）。
 * 口径：两位大写、空格分隔；GBK/二进制也按真实字节展开（旧实现先解码成文本再 UTF-8 编码，
 * 非 UTF-8 字节会在这一步被替换掉——那是错的）。
 */
export function toHexDisplayBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

/**
 * 文本 → 十六进制显示串——Phase 5e `receiveMode="hex"`（保留给「手上只有文本」的旧调用）。
 *
 * 🔴 **单点真相源**：视图 HEX 栏（`hex` 形态入 `RingBuffer`）与接收日志给 AI 的 `hex` 字段
 * **必须是同一个换算**——两处各写一份的下场是「界面看到的 HEX」与「AI 读到的 HEX」在边界字节上
 * 悄悄分叉，而没有任何灯会亮。D1 起接收路径走 `toHexDisplayBytes`（真实字节优先）。
 */
export function toHexDisplay(text: string): string {
  return toHexDisplayBytes(new TextEncoder().encode(text));
}

/** E5.8#30.20：文件名消毒——Windows 非法文件名字符（\ / : * ? " < > |）与控制字符 → "_"（防路径穿越 + 防非法文件名）。 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").replace(/[\x00-\x1F\x7F]/g, "_").trim();
  return cleaned || "serial";
}
