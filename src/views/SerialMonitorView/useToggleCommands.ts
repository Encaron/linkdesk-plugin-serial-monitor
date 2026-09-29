/**
 * 开关类命令的**视图态那一半**——M2 `AI#67` 重构（原为七条开关的 handler ＋ 七块标题刷新）。
 *
 * 🔴 结构变化与理由：六条会话态开关（发送模式／回显／行号／系统消息独立显示／自动重发／自动清屏）
 * 的 handler 已搬到 `services/serialCommands.ts`（插件级、常驻）——它们改的是**会话表**（模块级单例），
 * 与视图在场与否无关；而门外 AI 要点名改的那条会话**可能根本没开标签页**（会话比标签页活得久）。
 * handler 留两份迟早分叉 ⇒ 本文件只留一件视图才有的事：
 * **命令面板标题随当前态翻转**（`titleKey(当前值)`，与插件级注册共用同一处文案）。
 * ⚠️ 两条注册共用同一个 handler 引用（`SESSION_TOGGLE_HANDLERS[id]`）——⛔ 别在这里手写第二份实现。
 *
 * `togglePause` **留在这里**：`paused` 是视图态（`stream.paused`，不在会话表里），没有视图就没有它
 * ⇒ 本插件唯一一条「必须视图在场」的开关。它照样认 `sessionId`（会话寻址统一口径），
 * 只是目标会话没挂载视图时**给可读回执**，而不是老代码 `getActiveCmd()!` 那种 null 解引用。
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  SESSION_TOGGLE_HANDLERS, addressSession, badArg, readSessionId, sessionToggleTitleKey,
} from "../../services/serialCommands";
import { _cmdMap } from "../../services/commandBridge";
import type { SerialSettings } from "./settings";

export interface ToggleCommandsOptions {
  settings: SerialSettings;
  paused: boolean;
}

/** 注册一条开关的**标题**（handler 引用取自插件级那份）——`t` 由调用方给，模块级不持 hook */
function refreshToggleTitle(t: (key: string) => string, id: string, current: unknown): void {
  window.linkdesk?.commands?.registerCommand?.(id, SESSION_TOGGLE_HANDLERS[id], {
    title: t(sessionToggleTitleKey(id, current)),
    category: t("串口监视器"),
  });
}

export function useToggleCommands({ settings, paused }: ToggleCommandsOptions) {
  const { t } = useTranslation();
  const { sendMode, showEcho, showLineNumbers, separateSystemLog, autoRepeat, autoClear } = settings;

  // ── 暂停/继续：唯一住视图的开关（见文件头注） ──
  useEffect(() => {
    window.linkdesk?.commands?.registerCommand?.(
      "serial-monitor.togglePause",
      async (...args: unknown[]) => {
        const target = addressSession(readSessionId(args));
        if (!("session" in target)) return target;
        const cmd = _cmdMap.get(target.session.id);
        if (!cmd) {
          return badArg(
            "no-view",
            `会话「${target.session.name}」没有挂载标签页——暂停是视图态（不在会话表里），先开它的串口标签页再切`,
          );
        }
        cmd.setPaused((p: boolean) => !p);
        // ⚠️ `cmd.paused` 是该视图**上一次渲染时**的快照（React state 异步生效）⇒ 这里回的 `value`
        // 是「刚下的那一脚要变成的值」，不是回读值。视图态没有可回读的存储层，如实说（会话表那些
        // 开关的 `value` 才是回读出来的——它们住在 store 里）。
        return {
          ok: true, sessionId: target.session.id, name: target.session.name,
          field: "paused", value: !cmd.paused, previous: cmd.paused,
        };
      },
      { title: paused ? t("继续接收") : t("暂停接收"), category: t("串口监视器") },
    );
  }, [paused, t]);

  // ── 六条会话态开关：只刷标题（handler 与初注册都在插件级） ──
  useEffect(() => { refreshToggleTitle(t, "serial-monitor.toggleSendMode", sendMode); }, [sendMode, t]);
  useEffect(() => { refreshToggleTitle(t, "serial-monitor.toggleEcho", showEcho); }, [showEcho, t]);
  useEffect(() => { refreshToggleTitle(t, "serial-monitor.toggleLineNumbers", showLineNumbers); }, [showLineNumbers, t]);
  useEffect(() => { refreshToggleTitle(t, "serial-monitor.toggleSystemLog", separateSystemLog); }, [separateSystemLog, t]);
  useEffect(() => { refreshToggleTitle(t, "serial-monitor.toggleAutoRepeat", autoRepeat); }, [autoRepeat, t]);
  useEffect(() => { refreshToggleTitle(t, "serial-monitor.toggleAutoClear", autoClear); }, [autoClear, t]);
}
