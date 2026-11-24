/**
 * 串口入站（D1/D2）——**插件侧唯一解码头**。
 *
 * 壳只给 `{portName, dir, data:Uint8Array, at}`（读口 rx / 写口 tx）；本模块负责：
 *   ① 按 `\n` 拼行（壳不再拆行；无 `\n` 时 100ms idle flush，对齐旧壳 `flushLines` 语义）；
 *   ② 用**会话级** receiveCoding/sendCoding 解码（`decodeBytes` 共享原语，⛔ 不写第二份解码器）；
 *   ③ 「自动」档 = UTF-8 strict → GB2312（回退顺序具名常量，⛔ 藏在 if 链）；
 *   ④ HEX 由**原始字节**算（⛔ 不从 text 反推——GBK/二进制才对）。
 *
 * 订阅是一次性的进程级常驻（入口顶层 `ensureReceiveLogSubscribed()` 调它）；视图与接收日志
 * 各订阅 `subscribeSerialInbound`，按 `dir` 分流（视图只显示 rx，tx 的回显仍走发送路径本地 echo）。
 */
import { SERIAL_CODINGS, decodeBytes, type SerialCoding } from "@linkdesk/plugin-sdk/runtime";
import type { SerialDataPayload } from "@linkdesk/contracts";
import { _store } from "../hooks/useSerialSessions/store";
import { toHexDisplayBytes } from "../utils/text";

/** 配置/存储值用 ASCII 哨兵（⛔ 中文会被 i18n 审计当成未走 t() 的字面量）；UI 标签仍是 `t("自动")` */
export const AUTO_CODING = "auto";
/** 「自动」档的回退顺序——具名常量（06 §二：⛔ 藏在 if 链） */
const AUTO_CODING_FALLBACK = ["UTF-8", "GB2312"] as const;
/** 无 \n 数据的 idle flush 窗口——对齐旧壳 100ms 残留冲刷 */
const IDLE_FLUSH_MS = 100;

const LF = 0x0a;
const CR = 0x0d;

export interface SerialInboundLine {
  portName: string;
  dir: "rx" | "tx";
  /** 解码后并 trim 的行文本（与旧壳 flushLines 的 `.trim()` 同口径） */
  text: string;
  /** 行内容原始字节（去行尾 LF/CR）——HEX 的唯一来源 */
  bytes: Uint8Array;
  /** 原始字节的 HEX 形态（两位大写、空格分隔） */
  hex: string;
  /** 壳边界的时间戳（payload.at；缺省 Date.now()） */
  at: number;
}

type Listener = (line: SerialInboundLine) => void;
const _listeners = new Set<Listener>();

interface PortBuffer {
  pending: Uint8Array;
  timer: ReturnType<typeof setTimeout> | null;
  lastAt: number;
}
const _buffers = new Map<string, PortBuffer>();

/** 已订阅的 serial 面——测试/热重载换面时重新订阅（旧面丢弃） */
let _subscribedTo: unknown = null;

function isSerialCoding(v: unknown): v is SerialCoding {
  return typeof v === "string" && (SERIAL_CODINGS as readonly string[]).includes(v);
}

/** 本口当前会话的编码：优先活动会话，其次第一条绑口会话；rx 允许「自动」，tx 只认发送编码。 */
function codingFor(portName: string, dir: "rx" | "tx"): SerialCoding | typeof AUTO_CODING {
  const sessions = _store.sessions.filter((s) => s.port === portName);
  const session = sessions.find((s) => s.id === _store.activeSessionId) ?? sessions[0];
  const raw = dir === "tx" ? session?.sendCoding : session?.receiveCoding;
  if (dir === "rx" && raw === AUTO_CODING) return AUTO_CODING;
  return isSerialCoding(raw) ? raw : "UTF-8";
}

function decodeLine(bytes: Uint8Array, coding: SerialCoding | typeof AUTO_CODING): string {
  if (coding === AUTO_CODING) {
    for (const c of AUTO_CODING_FALLBACK) {
      try {
        return decodeBytes(bytes, c, { strict: true });
      } catch {
        // 换下一档
      }
    }
    return decodeBytes(bytes, "GB2312");
  }
  return decodeBytes(bytes, coding);
}

function emit(line: SerialInboundLine): void {
  for (const fn of _listeners) {
    try {
      fn(line);
    } catch {
      // 单个订阅者异常不阻断其他订阅者（视图/日志各一条腿）
    }
  }
}

/** 去掉行尾 LF 与可选 CR——text/hex 的口径（行内容不含终止符） */
function stripLineEnd(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  if (end > 0 && bytes[end - 1] === LF) end--;
  if (end > 0 && bytes[end - 1] === CR) end--;
  return bytes.subarray(0, end);
}

function emitBytes(portName: string, dir: "rx" | "tx", bytes: Uint8Array, at: number): void {
  if (bytes.length === 0) return;
  const text = decodeLine(bytes, codingFor(portName, dir)).trim();
  if (!text) return;
  emit({ portName, dir, text, bytes, hex: toHexDisplayBytes(bytes), at });
}

/** 跨 realm 安全的 Uint8Array 判定——`instanceof` 在 jsdom（测试）里会跨 realm 失配。 */
export function isUint8Array(v: unknown): v is Uint8Array {
  return Object.prototype.toString.call(v) === "[object Uint8Array]";
}

/** RX：拼行进缓冲——`\n` 即出；剩余字节等下一块或 idle flush。 */
function appendRx(portName: string, chunk: Uint8Array, at: number): void {
  let buf = _buffers.get(portName);
  if (!buf) {
    buf = { pending: new Uint8Array(0), timer: null, lastAt: at };
    _buffers.set(portName, buf);
  }
  buf.lastAt = at;

  const merged = new Uint8Array(buf.pending.length + chunk.length);
  merged.set(buf.pending);
  merged.set(chunk, buf.pending.length);

  let start = 0;
  for (let i = 0; i < merged.length; i++) {
    if (merged[i] !== LF) continue;
    // 行内容含 LF——stripLineEnd 去掉 LF/CR 后再解码（与旧壳 decode→trim 同结果）
    emitBytes(portName, "rx", stripLineEnd(merged.subarray(start, i + 1)).slice(), at);
    start = i + 1;
  }
  buf.pending = merged.slice(start);

  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  if (buf.pending.length > 0) {
    buf.timer = setTimeout(() => {
      if (!buf) return;
      buf.timer = null;
      const pending = buf.pending;
      buf.pending = new Uint8Array(0);
      emitBytes(portName, "rx", stripLineEnd(pending).slice(), buf.lastAt);
    }, IDLE_FLUSH_MS);
  }
}

/** TX：壳写口给的字节——不拼行（保持「一次发送一条回显」），仅供接收日志/外部消费者。 */
function appendTx(portName: string, chunk: Uint8Array, at: number): void {
  emitBytes(portName, "tx", chunk.slice(), at);
}

/**
 * 挂上串口广播——幂等；`window.linkdesk.serial` 换面（测试/热重载）时重新订阅。
 * @returns 串口面是否存在（false = 没挂上，⛔ 不假装收着）
 */
export function ensureSerialInboundSubscribed(): boolean {
  const s = window.linkdesk?.serial;
  if (!s?.onData) return false;
  if (_subscribedTo === s) return true;
  _subscribedTo = s;

  s.onData((payload: SerialDataPayload) => {
    // 运行期防御：旧壳/坏载荷没有 data 就丢（不崩、不猜）
    const data = (payload as { data?: unknown })?.data;
    const portName = (payload as { portName?: unknown })?.portName;
    if (!isUint8Array(data) || typeof portName !== "string") return;
    const dir = (payload as { dir?: unknown }).dir === "tx" ? "tx" : "rx";
    const at = (payload as { at?: unknown }).at;
    const ts = typeof at === "number" ? at : Date.now();
    if (dir === "tx") appendTx(portName, data, ts);
    else appendRx(portName, data, ts);
  });

  s.onSystem?.((payload) => {
    const raw = payload as unknown as { portName?: unknown; message?: unknown } | string | null;
    if (!raw || typeof raw === "string") return;
    const portName = raw.portName;
    const msg = typeof raw.message === "string" ? raw.message : "";
    if (typeof portName !== "string" || !portName) return;
    if (msg.includes("关闭")) {
      flushSerialInboundPort(portName);
      resetSerialInboundPort(portName);
    } else if (msg.includes("已打开")) {
      resetSerialInboundPort(portName);
    }
  });

  return true;
}

/** 订阅解码后的行——返回退订函数（视图与接收日志各一条）。 */
export function subscribeSerialInbound(cb: Listener): () => void {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

/** 丢弃本口未成行的残留（开新会话/关口时调）。 */
export function resetSerialInboundPort(portName: string): void {
  const buf = _buffers.get(portName);
  if (buf?.timer) clearTimeout(buf.timer);
  _buffers.delete(portName);
}

/** 把本口未成行的残留当成一行冲出去（关口时调——AI 读得到最后一段）。 */
export function flushSerialInboundPort(portName: string): void {
  const buf = _buffers.get(portName);
  if (!buf) return;
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }
  const pending = buf.pending;
  buf.pending = new Uint8Array(0);
  if (pending.length > 0) emitBytes(portName, "rx", stripLineEnd(pending).slice(), buf.lastAt);
}

/** 测试/热重载复位——清监听者、缓冲与订阅记忆（生产入口不调用）。 */
export function _resetSerialInbound(): void {
  for (const buf of _buffers.values()) if (buf.timer) clearTimeout(buf.timer);
  _buffers.clear();
  _listeners.clear();
  _subscribedTo = null;
}
