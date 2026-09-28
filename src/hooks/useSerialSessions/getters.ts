/**
 * 活动会话 / 按 id 取会话——E6#87b 从 hooks/useSerialSessions.ts 搬出（只搬不改）。
 * 模块级 getter——非 React 环境（命令 handler / beforeClose）消费。
 *
 * 本夹 = 会话表的**模块级写入咽喉**：`useSerialSessions` 的 create/remove 也委托到这里
 * （照 `closePortFromModule` 先例——同一动作一个写入处，防「命令建的会话」与「手点建的会话」
 * 在计数器/色板/活跃态上分叉）。
 */

import type { SerialSession } from "./types";
import { cloneDefaults, SESSION_COLORS } from "./types";
import { _notify, _store } from "./store";

export function getActiveSessionId(): string | null { return _store.activeSessionId; }
export function setActiveSessionId(id: string | null): void { _store.activeSessionId = id; _notify(); }
export function getSessionById(id: string): SerialSession | undefined { return _store.sessions.find((s) => s.id === id); }
export function updateSessionById(id: string, patch: Partial<SerialSession>): void { _store.sessions = _store.sessions.map((s) => s.id === id ? { ...s, ...patch } : s); _notify(); }

/** 全部会话（只读快照）——命令 handler 按名字找会话 / 报「现有哪几个」时的读入口 */
export function getSessions(): SerialSession[] { return _store.sessions; }

/** 新建会话——写入咽喉版（id 缺省走计数器命名，色板按 colorIndex 轮换，建完即置为活跃）。
 *  UI（侧栏「新建」）与命令 handler 共用：两处若各写一份，计数器/色板迟早分叉。 */
export function createSessionModule(name: string, id?: string): SerialSession {
  const session: SerialSession = {
    id: id || `serial-monitor-${++_store.sessionCounter}`,
    name, ...cloneDefaults(), color: SESSION_COLORS[_store.colorIndex % SESSION_COLORS.length],
  };
  _store.colorIndex++;
  _store.sessions = [..._store.sessions, session];
  _store.activeSessionId = session.id;
  _notify();
  return session;
}

/** 删会话——写入咽喉版：摘掉该条 + 活跃态让位（空表则回 null）。标签页的关闭是另一件事
 *  （`.tabs.closeBySourceId`），调用方按需自己接——本函数只管会话表。 */
export function removeSessionById(id: string): void {
  _store.sessions = _store.sessions.filter((s) => s.id !== id);
  if (_store.activeSessionId === id) _store.activeSessionId = _store.sessions.length > 0 ? _store.sessions[0].id : null;
  _notify();
}
