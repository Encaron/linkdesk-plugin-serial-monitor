/**
 * 视图命令注册（数据/剪贴板族）——E6#87b 从 src/index.tsx 的 SerialMonitorView 搬出（只搬不改）。
 *
 * Phase 5b：注册终端命令真实 handler（覆盖 loader 的 placeholder）。
 * 本文件 = 复制 / 全选 / 清空 / 快捷发送 / 导出日志；开关类命令在 useToggleCommands。
 * 「发送」与端口/会话族命令**不在这里**——它们不依赖视图，住 `services/serialCommands.ts`（M2 AI#23）。
 *
 * 清理归口：最后一个串口监视器标签页关闭时 unregisterCommands（#36k2）——放本文件（同批 effect 最先声明者）。
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { clearAllDecos } from "../../cm6/decorations";
import { saveFilePicker } from "../../utils/saveFile";
import { _cmdMap, getActiveCmd } from "../../services/commandBridge";
import { registerSerialCommands } from "../../services/serialCommands";

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
      if (!view) return;
      view.focus();
      const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
      if (sel) navigator.clipboard.writeText(sel);
    }, { title: t("复制"), category: cat });
    reg("serial-monitor.selectAll", async () => {
      const view = getActiveCmd()!.cmView.current;
      if (!view) return;
      view.focus();
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    }, { title: t("全选"), category: cat });
    reg("serial-monitor.clear", async () => {
      const view = getActiveCmd()!.cmView.current;
      if (view) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length },
          effects: clearAllDecos.of(undefined),
        });
      }
    }, { title: t("清空接收区"), category: cat });
    reg("serial-monitor.quickSendFill", async (...args) => {
      const ctx = args[0] as { quickSendName?: string } | undefined;
      if (ctx?.quickSendName) {
        getActiveCmd()!.setSendValue(getActiveCmd()!.quickSends[ctx.quickSendName] ?? "");
      }
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
    }, { title: t("编辑"), category: cat });
    reg("serial-monitor.quickSendDelete", async (...args) => {
      const ctx = args[0] as { quickSendName?: string } | undefined;
      if (ctx?.quickSendName) {
        getActiveCmd()!.handleDeleteQuickSend(ctx.quickSendName);
      }
    }, { title: t("删除"), category: cat });
    reg("serial-monitor.clearSend", async () => {
      getActiveCmd()!.setSendValue("");
    }, { title: t("清空发送区"), category: cat });
    reg("serial-monitor.exportLog", async () => {
      const view = getActiveCmd()!.cmView.current;
      if (!view) return;
      const text = view.state.doc.toString();
      const filename = `serial-log-${Date.now()}.txt`;
      try {
        const handle = await saveFilePicker?.({
          suggestedName: filename,
          types: [{ description: "Text", accept: { "text/plain": [".txt"] } }],
        });
        if (!handle) throw new Error("File System Access API 不可用");
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
      } catch {
        // 用户取消保存——静默
      }
    }, { title: t("导出日志"), category: cat });

    // #36k2：最后一个串口监视器标签页关闭时清理命令注册
    return () => {
      if (_cmdMap.size <= 1) {
        lk?.commands?.unregisterCommands?.("serial-monitor");
        // M2 AI#23：上面那句是**粗粒度**的（`unregisterCommands(pluginId)` 按属主整片摘，
        // 没有单条版）——插件级命令（端口/会话/发送族，入口顶层注册）被一并摘掉了。
        // 原样补回：它们是模块级单例（_openPorts/_store.sessions）的命令面，与视图在场与否无关。
        // ⚠️ 补回走的是同一份 registerSerialCommands——⛔ 别在这里手写第二条注册链（两份迟早分叉）。
        registerSerialCommands();
      }
    };
  }, [t]);
}
