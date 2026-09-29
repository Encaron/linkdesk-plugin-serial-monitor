/**
 * 开关类命令的**视图态那一半**——M2 `AI#67` 重构（原为七条开关的 handler ＋ 七块标题刷新）。
 *
 * 🔴 结构变化与理由：六条会话态开关（发送模式／回显／行号／系统消息独立显示／自动重发／自动清屏）
 * 的 handler 已搬到 `services/serialCommands.ts`（插件级、常驻）——它们改的是**会话表**（模块级单例），
 * 与视图在场与否无关；而门外 AI 要点名改的那条会话**可能根本没开标签页**（会话比标签页活得久）。
 * ⚠️ 两条注册共用同一个 handler 引用（`SESSION_TOGGLE_HANDLERS[id]`）——⛔ 别在这里手写第二份实现。
 *
 * `AI#68`：**本文件不再刷标题**（`refreshToggleTitle` ＋ 六处 `useEffect` 已删）。命令面板标题是
 * **一个命令 id 一个槽**（壳侧全局共享），而状态是**每条会话各自的**——多挂一个串口标签页就多一个
 * 写手，谁都可能把槽写成自己那条会话的状态 ⇒ 那个标题按构造不可靠（真机复现：活跃会话的开关明明
 * 是「开」，标题却读成「关闭…」）。现在标题只说「这条命令干嘛」（插件级注册的那一份，与状态无关）。
 * 读状态走 `serial-monitor.listSessions`，或开关回执里的 `value`（改后回读）——⛔ 都别再从标题反推。
 *
 * `togglePause` **留在这里**：`paused` 是视图态（`stream.paused`，不在会话表里），没有视图就没有它
 * ⇒ 本插件唯一一条「必须视图在场」的开关。它照样认 `sessionId`（会话寻址统一口径），
 * 只是目标会话没挂载视图时**给可读回执**，而不是老代码 `getActiveCmd()!` 那种 null 解引用。
 * 它的标题同样是固定的「切换接收暂停」——`paused` 也**每条视图各自**，理由同上。
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { addressSession, badArg, readSessionId } from "../../services/serialCommands";
import { _cmdMap } from "../../services/commandBridge";

export function useToggleCommands() {
  const { t } = useTranslation();

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
      { title: t("切换接收暂停"), category: t("串口监视器") },
    );
  }, [t]);
}
