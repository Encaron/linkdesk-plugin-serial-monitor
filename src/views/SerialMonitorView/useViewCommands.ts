/**
 * 视图命令注册（数据/剪贴板族）——E6#87b 从 src/index.tsx 的 SerialMonitorView 搬出（只搬不改）。
 *
 * Phase 5b：注册终端命令真实 handler（覆盖 loader 的 placeholder）。
 * 本文件 = 复制 / 全选 / 清空 / 快捷发送 / 导出日志；开关类命令在 useToggleCommands。
 * 「发送」与端口/会话族命令**不在这里**——它们不依赖视图，住 `services/serialCommands.ts`（M2 AI#23）。
 *
 * T9：作用域分区由池接管——视图卸载只摘本视图作用域，⛔ 不再整片 unregister＋补注册。
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { clearAllDecos } from "../../cm6/decorations";
import { saveFilePicker } from "../../utils/saveFile";
import { getActiveCmd } from "../../services/commandBridge";

export function useViewCommands() {
  const { t } = useTranslation();

  useEffect(() => {
    const lk = window.linkdesk;
    const reg = lk?.commands?.registerCommand;
    if (!reg) return;

    // E5.7 Bug C 补全：meta 恢复 E5.6 语义——title/category 同步壳注册表（命令面板/右键菜单
    // 显示 i18n 标题），toggle 命令的最终动态标题由下方 per-state effect 重注册覆盖。
    const cat = t("串口监视器");

    reg("serial-monitor.copy", async () => {
      const view = getActiveCmd()!.cmView.current;
      if (!view) return { copied: 0 };
      view.focus();
      const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
      if (sel) navigator.clipboard.writeText(sel);
      return { copied: sel.length };
    }, { title: t("复制"), category: cat });
    reg("serial-monitor.selectAll", async () => {
      const view = getActiveCmd()!.cmView.current;
      if (!view) return { selected: 0 };
      view.focus();
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
      return { selected: view.state.doc.length };
    }, { title: t("全选"), category: cat });
    reg("serial-monitor.clear", async () => {
      const view = getActiveCmd()!.cmView.current;
      if (!view) return { cleared: 0 };
      const cleared = view.state.doc.length;
      view.dispatch({
        changes: { from: 0, to: cleared },
        effects: clearAllDecos.of(undefined),
      });
      return { cleared };
    }, { title: t("清空接收区"), category: cat });
    reg("serial-monitor.quickSendFill", async (...args) => {
      const ctx = args[0] as { quickSendName?: string } | undefined;
      if (ctx?.quickSendName) {
        getActiveCmd()!.setSendValue(getActiveCmd()!.quickSends[ctx.quickSendName] ?? "");
      }
      return { filled: Boolean(ctx?.quickSendName), quickSendName: ctx?.quickSendName ?? null };
    }, { title: t("回填到发送区"), category: cat });
    reg("serial-monitor.quickSendEdit", async (...args) => {
      const ctx = args[0] as { quickSendName?: string } | undefined;
      if (ctx?.quickSendName) {
        const key = ctx.quickSendName;
        getActiveCmd()!.setQsEditing(key);
        getActiveCmd()!.setQsName(key);
        getActiveCmd()!.setQsContent(getActiveCmd()!.quickSends[key] ?? "");
        getActiveCmd()!.setQsAdding(true);
      }
      return { editing: ctx?.quickSendName ?? null };
    }, { title: t("编辑"), category: cat });
    reg("serial-monitor.clearSend", async () => {
      getActiveCmd()!.setSendValue("");
      return { cleared: true };
    }, { title: t("清空发送区"), category: cat });
    reg("serial-monitor.exportLog", async () => {
      const view = getActiveCmd()!.cmView.current;
      if (!view) return { exported: false, bytes: 0, reason: "no-view" };
      const text = view.state.doc.toString();
      const filename = `serial-log-${Date.now()}.txt`;
      try {
        const handle = await saveFilePicker?.({
          suggestedName: filename,
          types: [{ description: "Text", accept: { "text/plain": [".txt"] } }],
        });
        if (!handle) return { exported: false, bytes: 0, reason: "cancelled" };
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return { exported: true, bytes: text.length };
      } catch {
        // 用户取消保存 / 保存 API 不可用——如实回执，不假装写过
        return { exported: false, bytes: 0, reason: "cancelled" };
      }
    }, { title: t("导出日志"), category: cat });
  }, [t]);
}
