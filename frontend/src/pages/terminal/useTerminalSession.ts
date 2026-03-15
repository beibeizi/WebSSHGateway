import React from "react";
import { useToast } from "../../components/Toast";
import { useApp } from "../../context/AppContext";
import { darkTerminalTheme, lightTerminalTheme } from "./terminalUtils";
import { useTerminalSocket } from "./useTerminalSocket";
import { useTerminalSessionInfo } from "./useTerminalSessionInfo";

function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

export function useTerminalSession(sessionId?: string) {
  const { push } = useToast();
  const {
    isDark,
    toggleTheme,
    toggleLanguage,
    language,
    networkProfile: globalNetworkProfile,
    reportNetworkHint,
    clearNetworkHint,
  } = useApp();
  const t = React.useCallback((zh: string, en: string) => localizeText(language, zh, en), [language]);
  const [currentDir, setCurrentDir] = React.useState<string>("/");
  const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(null);
  const enhancedSessionRef = React.useRef(false);

  const socketState = useTerminalSocket({
    sessionId,
    t,
    push,
    reportNetworkHint,
    clearNetworkHint,
    enhancedSessionRef,
    setCurrentDir,
  });

  const sessionInfoState = useTerminalSessionInfo({
    sessionId,
    globalNetworkProfile,
    connectionState: socketState.connectionState,
    reconnectCountdown: socketState.reconnectCountdown,
    enhancedSessionRef,
  });

  React.useEffect(() => {
    setSelectedFilePath(null);
    setCurrentDir("/");
  }, [sessionId]);

  React.useEffect(() => {
    const term = socketState.terminalInstance.current;
    if (!term) return;
    term.options.theme = isDark ? darkTerminalTheme : lightTerminalTheme;
    term.refresh(0, term.rows - 1);
  }, [isDark, socketState.terminalInstance]);

  const handleClear = React.useCallback(() => {
    const term = socketState.terminalInstance.current;
    if (!term) {
      return;
    }
    term.clear();
    push(t("已清屏", "Screen cleared"));
  }, [push, t, socketState.terminalInstance]);

  const handleSelectAll = React.useCallback(() => {
    const term = socketState.terminalInstance.current;
    if (!term) {
      return;
    }
    term.selectAll();
    push(t("已全选", "Selected all"));
  }, [push, t, socketState.terminalInstance]);

  const handleCopySelection = React.useCallback(async () => {
    const termSelection = socketState.terminalInstance.current?.getSelection() ?? "";
    const domSelection = window.getSelection()?.toString() ?? "";
    const selection = termSelection || domSelection;
    if (!selection) {
      push(t("没有可复制内容", "No selection to copy"));
      return;
    }

    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = selection;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selection);
        push(t("已复制选中内容", "Copied selection"));
        return;
      }
    } catch {
      // 使用降级方案处理复制失败。
    }

    if (fallbackCopy()) {
      push(t("已复制选中内容", "Copied selection"));
      return;
    }
    push(t("复制失败，请使用右键菜单", "Copy failed, use context menu"));
  }, [push, t, socketState.terminalInstance]);

  const connectionLabel =
    socketState.connectionState === "open"
      ? t("已连接", "Connected")
      : socketState.connectionState === "connecting"
      ? t("连接中", "Connecting")
      : t("已断开", "Disconnected");
  const connectionTone =
    socketState.connectionState === "open"
      ? "text-emerald-400"
      : socketState.connectionState === "connecting"
      ? "text-amber-400"
      : "text-rose-400";
  const networkProfileLabel =
    sessionInfoState.sessionNetworkProfile === "good"
      ? t("网络良好", "Network Good")
      : sessionInfoState.sessionNetworkProfile === "degraded"
      ? t("网络波动", "Network Fluctuating")
      : t("弱网模式", "Poor Network Mode");
  const networkProfileTone =
    sessionInfoState.sessionNetworkProfile === "good"
      ? "text-emerald-400"
      : sessionInfoState.sessionNetworkProfile === "degraded"
      ? "text-amber-400"
      : "text-rose-400";

  return {
    t,
    isDark,
    toggleTheme,
    toggleLanguage,
    language,
    sessionId,
    currentDir,
    selectedFilePath,
    setSelectedFilePath,
    terminalRef: socketState.terminalRef,
    terminalInstance: socketState.terminalInstance,
    fitAddon: socketState.fitAddon,
    connectionState: socketState.connectionState,
    reconnectCountdown: socketState.reconnectCountdown,
    autoReconnect: socketState.autoReconnect,
    setAutoReconnect: socketState.setAutoReconnect,
    syncTerminalSize: socketState.syncTerminalSize,
    handleReconnect: socketState.handleReconnect,
    handleCancelReconnect: socketState.handleCancelReconnect,
    sessionInfo: sessionInfoState.sessionInfo,
    targetLatencyMs: sessionInfoState.targetLatencyMs,
    latencyBarHeights: sessionInfoState.latencyBarHeights,
    latencyHistoryMaxMs: sessionInfoState.latencyHistoryMaxMs,
    sessionNetworkProfile: sessionInfoState.sessionNetworkProfile,
    sessionDisconnected: sessionInfoState.sessionDisconnected,
    connectionLabel,
    connectionTone,
    networkProfileLabel,
    networkProfileTone,
    handleClear,
    handleSelectAll,
    handleCopySelection,
  };
}

export type TerminalSessionState = ReturnType<typeof useTerminalSession>;
