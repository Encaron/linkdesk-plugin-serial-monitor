/**
 * 快捷发送条——E6#87b 从 src/index.tsx 的 SerialMonitorView 搬出（只搬不改）。
 * 药丸按钮 + 内联新增/编辑表单 + 右键菜单（编辑/删除）。
 */

import { useTranslation } from "react-i18next";
import { ContextMenu } from "@linkdesk/ui";

export interface QuickSendBarProps {
  quickSends: Record<string, string>;
  onQuickSend: (content: string) => void;
  onCtxMenu: (key: string, e: React.MouseEvent) => void;
  qsAdding: boolean;
  setQsAdding: (v: boolean) => void;
  qsEditing: string | null;
  setQsEditing: (v: string | null) => void;
  qsName: string;
  setQsName: (v: string) => void;
  qsContent: string;
  setQsContent: (v: string) => void;
  onSave: () => void;
  qsCtxMenu: { key: string; x: number; y: number } | null;
  onCloseQsCtxMenu: () => void;
}

export default function QuickSendBar(p: QuickSendBarProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* 快捷发送条 */}
      <div className="serial-monitor-quick-send-bar">
        {Object.entries(p.quickSends).map(([name, content]) => (
          <button
            key={name}
            className="serial-monitor-quick-send-pill"
            onClick={() => p.onQuickSend(content)}
            onContextMenu={(e) => p.onCtxMenu(name, e)}
            data-hint={content}
          >
            {name}
          </button>
        ))}
        {p.qsAdding ? (
          <div className="serial-monitor-quick-send-add-form">
            <input
              className="ldk-input serial-monitor-qs-input"
              placeholder={t("名称")}
              value={p.qsName}
              onChange={(e) => p.setQsName(e.target.value)}
              autoFocus
            />
            <input
              className="ldk-input serial-monitor-qs-input"
              placeholder={t("发送内容")}
              value={p.qsContent}
              onChange={(e) => p.setQsContent(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") p.onSave(); if (e.key === "Escape") { p.setQsAdding(false); p.setQsEditing(null); } }}
            />
            <button className="serial-monitor-toolbar-btn" onClick={p.onSave}>{p.qsEditing ? <span className="codicon codicon-edit" /> : <span className="codicon codicon-check" />}</button>
            <button className="serial-monitor-toolbar-btn" onClick={() => { p.setQsAdding(false); p.setQsEditing(null); }}><span className="codicon codicon-close" /></button>
          </div>
        ) : (
          <button className="serial-monitor-quick-send-add" data-hint={t("添加快捷发送")} onClick={() => p.setQsAdding(true)}>
            + {t("添加")}
          </button>
        )}
      </div>

      {/* Phase 5b：快捷发送右键菜单——共享 ContextMenu */}
      {p.qsCtxMenu && (
        <ContextMenu
          menuId={"quickSendContext"}
          anchor={{ x: p.qsCtxMenu.x, y: p.qsCtxMenu.y }}
          /* 2026-11-07 修右键空白：壳 getItems 对菜单项取 `item.when ?? cmd?.when` 过滤——
           * quickSendDelete/Edit 被 serialCommands 以 when: "activeEditor == 'serial-monitor'"
           * 抢先注册（首注册的 when 存活），本菜单原先只传 quickSendName ⇒ 右键时刻全局键不成立
           * ⇒ 全被滤成空盒。context overrides 优先于全局键（ContextKeyService._readKey），
           * 右键药丸必然在本视图内 ⇒ 补上即与语义成立。 */
          context={{ quickSendName: p.qsCtxMenu.key, activeEditor: "serial-monitor" }}
          onClose={p.onCloseQsCtxMenu}
        />
      )}
    </>
  );
}
