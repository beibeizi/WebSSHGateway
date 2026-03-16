import React from "react";
import { Button } from "../../components/Button";
import { FileBrowser } from "../../components/FileBrowser";
import { SystemMonitor } from "../../components/SystemMonitor";
import type { TerminalSessionState } from "./useTerminalSession";

type TerminalMobileProps = {
  state: TerminalSessionState;
  onBack: () => void;
};

type MobileTab = "terminal" | "files" | "system";

export function TerminalMobile({ state, onBack }: TerminalMobileProps) {
  const [activeTab, setActiveTab] = React.useState<MobileTab>("terminal");
  const { syncTerminalSize, terminalInstance, scrollTerminal } = state;

  React.useEffect(() => {
    if (activeTab !== "terminal") {
      return;
    }
    const term = terminalInstance.current;
    if (!term) {
      return;
    }
    syncTerminalSize(term, { force: true });
    term.focus();
  }, [activeTab, syncTerminalSize, terminalInstance]);

  const actions = [
    {
      key: "language",
      label: state.language === "en-US" ? "中文" : "EN",
      onClick: state.toggleLanguage,
      variant: "ghost" as const,
    },
    {
      key: "theme",
      label: state.isDark ? state.t("浅色", "Light") : state.t("深色", "Dark"),
      onClick: state.toggleTheme,
      variant: "ghost" as const,
    },
    {
      key: "copy",
      label: state.t("复制", "Copy"),
      onClick: state.handleCopySelection,
      variant: "secondary" as const,
    },
    {
      key: "clear",
      label: state.t("清屏", "Clear"),
      onClick: state.handleClear,
      variant: "ghost" as const,
    },
    {
      key: "select",
      label: state.t("全选", "Select all"),
      onClick: state.handleSelectAll,
      variant: "ghost" as const,
    },
  ];

  const shouldShowReconnect = state.connectionState === "closed" && state.reconnectCountdown === null;
  const shouldShowCancelReconnect = state.connectionState === "closed" && state.reconnectCountdown !== null;

  return (
    <div className={`flex min-h-screen flex-col transition-colors duration-300 ${state.isDark ? "bg-slate-950 text-slate-100 dark-scrollbar" : "bg-gray-100 text-slate-900 light-scrollbar"}`}>
      <div className={`border-b px-4 py-3 ${state.isDark ? "border-slate-800" : "border-slate-200 bg-white"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className={`text-base font-semibold truncate ${state.isDark ? "text-slate-100" : "text-slate-800"}`}>
              {state.sessionInfo?.name || state.t("会话", "Session")}
            </div>
            <div className={`text-xs truncate ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
              {state.sessionInfo ? new Date(state.sessionInfo.started_at).toLocaleString() : ""}
            </div>
          </div>
          <Button variant="secondary" lightMode={!state.isDark} onClick={onBack} className="px-3 py-2 text-xs whitespace-nowrap">
            {state.t("返回", "Back")}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`${state.connectionTone}`}>
            {state.reconnectCountdown !== null ? state.t(`重连中 (${state.reconnectCountdown}s)`, `Reconnecting (${state.reconnectCountdown}s)`) : state.connectionLabel}
          </span>
          <span className={`${state.networkProfileTone}`}>{state.networkProfileLabel}</span>
          {state.targetLatencyMs !== null ? (
            <span className={state.isDark ? "text-slate-500" : "text-slate-400"}>
              {state.targetLatencyMs}ms
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {actions.map((action) => (
            <Button
              key={action.key}
              variant={action.variant}
              lightMode={!state.isDark}
              onClick={action.onClick}
              className="px-3 py-2 text-xs whitespace-nowrap"
            >
              {action.label}
            </Button>
          ))}
          {shouldShowCancelReconnect ? (
            <Button
              variant="ghost"
              lightMode={!state.isDark}
              onClick={state.handleCancelReconnect}
              className="px-3 py-2 text-xs whitespace-nowrap"
            >
              {state.t("取消重连", "Cancel reconnect")}
            </Button>
          ) : null}
          {shouldShowReconnect ? (
            <Button
              variant="secondary"
              lightMode={!state.isDark}
              onClick={state.handleReconnect}
              className="px-3 py-2 text-xs whitespace-nowrap"
            >
              {state.t("重连", "Reconnect")}
            </Button>
          ) : null}
        </div>
        {state.sessionInfo?.note ? (
          <div className={`mt-2 text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
            {state.sessionInfo.note}
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 pb-16">
        <div className={`${activeTab === "terminal" ? "flex" : "hidden"} h-full flex-col`}>
          <div className="flex-1 p-3 min-h-0 relative">
            <div
              ref={state.terminalRef}
              className={`h-full w-full rounded-lg border ${state.isDark ? "border-slate-800" : "border-slate-300 xterm-light"} ${state.sessionInfo?.enhanced_enabled ? "xterm-tmux-enhanced" : ""}`}
              tabIndex={-1}
              onClick={() => state.terminalInstance.current?.focus()}
            />
            <div className="absolute right-4 bottom-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => scrollTerminal("up")}
                className={`h-10 w-10 rounded-full border text-base ${
                  state.isDark
                    ? "border-slate-700 bg-slate-900/90 text-slate-200"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
                aria-label={state.t("向上滚动终端", "Scroll terminal up")}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => scrollTerminal("down")}
                className={`h-10 w-10 rounded-full border text-base ${
                  state.isDark
                    ? "border-slate-700 bg-slate-900/90 text-slate-200"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
                aria-label={state.t("向下滚动终端", "Scroll terminal down")}
              >
                ↓
              </button>
            </div>
          </div>
        </div>

        <div className={`${activeTab === "files" ? "flex" : "hidden"} h-full flex-col`}>
          <div className="flex-1 p-3 min-h-0">
            {state.sessionId ? (
              <FileBrowser
                sessionId={state.sessionId}
                isDark={state.isDark}
                currentDir={state.currentDir}
                onFileSelect={state.setSelectedFilePath}
                networkProfile={state.sessionNetworkProfile}
                compact
              />
            ) : null}
          </div>
        </div>

        <div className={`${activeTab === "system" ? "flex" : "hidden"} h-full flex-col`}>
          <div className="flex-1 p-3 min-h-0 overflow-y-auto">
            {state.sessionId ? (
              <SystemMonitor
                sessionId={state.sessionId}
                isDark={state.isDark}
                selectedFilePath={state.selectedFilePath || undefined}
                networkProfile={state.sessionNetworkProfile}
                compact
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className={`fixed bottom-0 left-0 right-0 z-50 border-t ${state.isDark ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white"}`}>
        <div className="flex">
          {[
            { key: "terminal", label: state.t("终端", "Terminal") },
            { key: "files", label: state.t("文件", "Files") },
            { key: "system", label: state.t("系统", "System") },
          ].map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as MobileTab)}
                className={`flex-1 py-3 text-sm font-medium transition ${
                  active
                    ? (state.isDark ? "text-indigo-300" : "text-indigo-600")
                    : (state.isDark ? "text-slate-400" : "text-slate-500")
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {state.sessionDisconnected?.disconnected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950">
          <div className="text-center">
            <div className="text-2xl mb-4 text-rose-400">{state.t("会话已断开", "Session disconnected")}</div>
            <div className="text-sm text-slate-400">{state.t("断开时间", "Disconnected at")}: {state.sessionDisconnected.time}</div>
          </div>
        </div>
      )}
    </div>
  );
}
