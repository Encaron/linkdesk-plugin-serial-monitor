/**
 * 发送区——E6#87b 从 src/index.tsx 的 SerialMonitorView 搬出（只搬不改）。
 *
 * ⚠️ 本组件只提供 DOM 容器（`sendEditorContainer` ref 由门面持有）；发送区 EditorView 的
 *    创建/销毁在 useSendEditorCm 内——CM6 生命周期与视图组件一致。
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export interface SenderAreaProps {
  hexWarning: string;
  sendEditorContainer: React.MutableRefObject<HTMLDivElement | null>;
  showHistory: boolean;
  setShowHistory: (v: boolean) => void;
  sendHistory: string[];
  onHistorySelect: (text: string) => void;
  onClearSend: () => void;
  onSend: () => void;
}

export default function SenderArea(p: SenderAreaProps) {
  const { t } = useTranslation();
  const { showHistory, setShowHistory } = p;

  /* 2026-11-07 修「发送历史下拉不失焦消失」：showHistory 时常驻两个监听——
   *  ① pointerdown（capture）点 wrapper 外即收；② Esc 收。▼ 按钮在 wrapper 内不受影响，
   *  toggle 语义不破（点按钮 = pointerdown 在内不触发关 + click 正常翻转）。 */
  const historyWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showHistory) return;
    const onDown = (e: PointerEvent) => {
      if (!historyWrapRef.current?.contains(e.target as Node)) setShowHistory(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHistory(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line linkdesk/no-global-key-listener -- Esc 只关本下拉：无 preventDefault、不拦键，非「抢键」反模式（历史案是抢 F2）；CM 编辑器聚焦时 wrapper onKeyDown 收不到，窗口级是自绘浮层 Esc 收的唯一落点
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [showHistory, setShowHistory]);

  return (
    <div className="serial-monitor-sender-area">
      {p.hexWarning && (
        <div className="serial-monitor-hex-warning">{p.hexWarning}</div>
      )}
      <div className="serial-monitor-send-editor-wrapper">
        <span className="serial-monitor-send-editor-prefix">→</span>
        <div ref={p.sendEditorContainer} className="serial-monitor-send-editor-cm" />
      </div>
      <div className="serial-monitor-sender-actions">
        <div className="serial-monitor-history-wrapper" ref={historyWrapRef}>
          <button
            className={`serial-monitor-toolbar-btn${p.showHistory ? " active" : ""}`}
            onClick={() => p.setShowHistory(!p.showHistory)}
            data-hint={t("发送历史")}
            disabled={p.sendHistory.length === 0}
          >
            ▼
          </button>
          {p.showHistory && p.sendHistory.length > 0 && (
            <div className="serial-monitor-history-dropdown">
              {p.sendHistory.map((h, i) => (
                <div
                  key={i}
                  className="serial-monitor-history-item"
                  onClick={() => { p.onHistorySelect(h); p.setShowHistory(false); }}
                >
                  {h}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="serial-monitor-toolbar-btn" onClick={p.onClearSend}>
          {t("清空发送区")}
        </button>
        <button className="serial-monitor-send-btn" onClick={p.onSend}>
          {t("发送")}
        </button>
      </div>
    </div>
  );
}
