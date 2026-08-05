import React from "react";
import { useToast } from "../../components/ToastContext";
import { useApp } from "../../context/AppContextCore";
import { copyTextToClipboard } from "./clipboardUtils";
import { darkTerminalTheme, lightTerminalTheme } from "./terminalUtils";
import { useTerminalSocket } from "./useTerminalSocket";
import { useTerminalSessionInfo } from "./useTerminalSessionInfo";

function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
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

  const copyText = React.useCallback(async (text: string): Promise<boolean> => {
    if (!text) {
      push(t("没有可复制内容", "No selection to copy"));
      return false;
    }

    const writeText = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined;
    const copied = await copyTextToClipboard(text, writeText, fallbackCopyText);
    if (copied) {
      push(t("已复制选中内容", "Copied selection"));
      return true;
    }
    push(t("复制失败，请使用系统复制菜单", "Copy failed, use the system copy menu"));
    return false;
  }, [push, t]);

  const handleCopySelection = React.useCallback(async () => {
    const termSelection = socketState.terminalInstance.current?.getSelection() ?? "";
    const domSelection = window.getSelection()?.toString() ?? "";
    await copyText(termSelection || domSelection);
  }, [copyText, socketState.terminalInstance]);

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
    scrollTerminal: socketState.scrollTerminal,
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
    copyText,
  };
}

export type TerminalSessionState = ReturnType<typeof useTerminalSession>;
