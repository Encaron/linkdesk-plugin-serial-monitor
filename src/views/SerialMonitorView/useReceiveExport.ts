/**
 * 接收区导出——E6#87b 从 src/index.tsx 的 SerialMonitorView 搬出（只搬不改）。
 *
 * 优先 File System Access API（saveFilePicker）；不可用时回落 Blob + <a download>。
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { EditorView } from "@codemirror/view";
import { saveFilePicker } from "../../utils/saveFile";
import type { LineType } from "../../types";

export interface ReceiveExportOptions {
  cmView: React.MutableRefObject<EditorView | null>;
  appendLine: (text: string, color: LineType) => void;
}

export function useReceiveExport(o: ReceiveExportOptions) {
  const { cmView, appendLine } = o;
  const { t } = useTranslation();

  const handleExport = useCallback(async () => {
    const view = cmView.current;
    if (!view) return;
    const text = view.state.doc.toString();
    const filename = `serial-log-${Date.now()}.txt`;

    // 2026-11-24（S2/D12）：优先宿主动作 `dialog.save`——只选落盘路径（起始目录/覆盖确认 = OS 原生），
    // 写入走壳 filesystem。⛔ 不再由插件自造第二套保存路径（旧壳无该面时才回落浏览器下载）。
    const save = window.linkdesk?.dialog?.save;
    if (save) {
      try {
        const target = await save({
          title: t("导出日志"),
          filters: [{ name: "Text", extensions: ["txt"] }],
          defaultName: filename,
        });
        if (!target) return; // 用户取消——不是失败，也不偷偷改走浏览器下载
        await window.linkdesk.filesystem.writeTextFile(target, text);
        appendLine(t("---- 日志已导出至 {{filename}} ----", { filename: target }), "system");
        return;
      } catch (e) {
        // 壳保存面异常 → 记录后回落旧链（不静默吞掉失败原因）
        console.error("[serial-monitor] 宿主保存对话框不可用，回落浏览器下载:", e);
      }
    }

    try {
      const handle = await saveFilePicker?.({
        suggestedName: filename,
        types: [{ description: "Text", accept: { "text/plain": [".txt"] } }],
      });
      if (!handle) throw new Error("File System Access API 不可用");
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      appendLine(t("---- 日志已导出至 {{filename}} ----", { filename }), "system");
    } catch {
      const blob = new Blob([text], { type: "text/plain;charset=UTF-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [cmView, appendLine, t]);

  return { handleExport };
}
