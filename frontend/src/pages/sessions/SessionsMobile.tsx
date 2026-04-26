import React from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import type { SessionsState } from "./useSessionsState";
import { SessionsConnectionsPanel } from "./SessionsConnectionsPanel";
import { SessionsDialogs } from "./SessionsDialogs";
import { SessionStatusSummary } from "./SessionStatusSummary";
import { clearAuthStorage } from "../../lib/api";

type SessionsMobileProps = {
  state: SessionsState;
};

export function SessionsMobile({ state }: SessionsMobileProps) {
  if (state.loading) {
    return <div className={`p-6 ${state.isDark ? "text-slate-200" : "text-slate-700"}`}>{state.t("加载中...", "Loading...")}</div>;
  }

  return (
    <div className={`min-h-screen px-4 py-6 transition-colors duration-300 ${state.isDark ? "bg-slate-950 text-slate-100 dark-scrollbar" : "bg-gray-100 text-slate-900 light-scrollbar"}`}>
      <div className="space-y-6">
        <div className={`space-y-3 pb-4 ${state.isDark ? "border-b border-slate-800" : "border-b border-slate-200"}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">{state.t("会话管理", "Session Management")}</h1>
              <p className={`text-xs ${state.networkProfileTone}`}>{state.networkProfileLabel}</p>
            </div>
            <Button
              variant="ghost"
              lightMode={!state.isDark}
              onClick={state.toggleLanguage}
              className="px-3 py-2 text-xs"
            >
              {state.language === "en-US" ? "中文" : "EN"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              lightMode={!state.isDark}
              onClick={state.toggleTheme}
              className="px-3 py-2 text-xs"
            >
              {state.isDark ? state.t("浅色", "Light") : state.t("深色", "Dark")}
            </Button>
            <Button
              variant="secondary"
              lightMode={!state.isDark}
              onClick={() => state.setPasswordDialogOpen(true)}
              className="px-3 py-2 text-xs"
            >
              {state.t("修改密码", "Change password")}
            </Button>
            <Button
              variant="ghost"
              lightMode={!state.isDark}
              onClick={() => {
                clearAuthStorage();
                window.location.href = "/";
              }}
              className="px-3 py-2 text-xs"
            >
              {state.t("退出登录", "Sign out")}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <Input
            placeholder={state.t("搜索会话名称", "Search session name")}
            value={state.search}
            onChange={(event) => state.setSearch(event.target.value)}
            className={`${state.isDark ? "" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
          />
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[
              { value: "all", label: state.t("全部", "All") },
              { value: "active", label: state.t("在线", "Active") },
              { value: "disconnected", label: state.t("离线", "Disconnected") },
            ].map((item) => (
              <Button
                key={item.value}
                variant={state.filter === item.value ? "primary" : "secondary"}
                lightMode={!state.isDark}
                onClick={() => state.setFilter(item.value)}
                className="px-3 py-2 text-xs whitespace-nowrap"
              >
                {item.label}
              </Button>
            ))}
            <Button
              variant="secondary"
              lightMode={!state.isDark}
              onClick={() => {
                window.location.href = "/settings";
              }}
              className="px-3 py-2 text-xs whitespace-nowrap"
            >
              {state.t("系统设置", "System Settings")}
            </Button>
            <Button
              variant="secondary"
              lightMode={!state.isDark}
              onClick={() => {
                window.location.href = "/logs";
              }}
              className="px-3 py-2 text-xs whitespace-nowrap"
            >
              <FileText className="h-4 w-4" />
              {state.t("日志", "Logs")}
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          {state.filteredSessions.map((session, index) => {
            const noteValue = state.noteDrafts[session.id] ?? "";
            const canMoveUp = index > 0 && !state.ordering.savingOrder;
            const canMoveDown = index < state.filteredSessions.length - 1 && !state.ordering.savingOrder;
            return (
              <div
                key={session.id}
                ref={(element) => {
                  if (element) {
                    state.ordering.cardRefs.current.set(session.id, element);
                  } else {
                    state.ordering.cardRefs.current.delete(session.id);
                  }
                }}
                className={`relative rounded-lg border p-4 pl-12 transition-transform duration-200 ease-out will-change-transform ${
                  state.isDark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white shadow-sm"
                }`}
              >
                <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className={`flex flex-col items-center gap-1 rounded-full border p-1 ${state.isDark ? "border-slate-700 bg-slate-900 text-slate-400" : "border-slate-200 bg-white text-slate-500"}`}>
                    <button
                      type="button"
                      onClick={() => state.ordering.handleMoveSession(session.id, "up")}
                      disabled={!canMoveUp}
                      className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                        canMoveUp
                          ? (state.isDark ? "hover:bg-slate-800 text-slate-200" : "hover:bg-slate-100 text-slate-700")
                          : "opacity-40 cursor-not-allowed"
                      }`}
                      aria-label={state.t("上移会话", "Move session up")}
                    >
                      <ChevronUp className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => state.ordering.handleMoveSession(session.id, "down")}
                      disabled={!canMoveDown}
                      className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                        canMoveDown
                          ? (state.isDark ? "hover:bg-slate-800 text-slate-200" : "hover:bg-slate-100 text-slate-700")
                          : "opacity-40 cursor-not-allowed"
                      }`}
                      aria-label={state.t("下移会话", "Move session down")}
                    >
                      <ChevronDown className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-base font-semibold">{session.name}</p>
                    <p className={`text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
                      {session.username}@{session.host}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>{state.t("状态", "Status")}: {state.mapSessionStatus(session.status)}</p>
                    {session.enhanced_enabled ? (
                      <p className={`text-xs font-medium ${state.isDark ? "text-indigo-300" : "text-indigo-600"}`}>
                        {state.t("增强持久化连接", "Enhanced persistent connection")}
                      </p>
                    ) : null}
                    <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>{state.t("创建时间", "Created at")}: {new Date(session.started_at).toLocaleString()}</p>
                    <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>{state.t("最近活动", "Last activity")}: {new Date(session.last_activity).toLocaleString()}</p>
                    {session.disconnected_at ? (
                      <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
                        {state.t("断开时间", "Disconnected at")}: {new Date(session.disconnected_at).toLocaleString()}
                      </p>
                    ) : null}
                    {session.enhanced_enabled && session.status !== "active" && session.allow_auto_retry !== false ? (
                      <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
                        {state.t("本轮重试", "Retry cycle")}: {session.retry_cycle_count ?? 0}/{state.enhancedRetryMaxAttempts}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    {session.status === "active" ? (
                      <Button variant="secondary" lightMode={!state.isDark} className="w-full" onClick={() => window.open(`/terminal/${session.id}`, "_blank")}>
                        {state.t("打开会话", "Open session")}
                      </Button>
                    ) : null}
                    {session.enhanced_enabled && session.status !== "active" && session.allow_auto_retry !== false ? (
                      <Button
                        variant="secondary"
                        lightMode={!state.isDark}
                        loading={state.isSystemRetrying(session) || !!state.retryingSessionIds[session.id]}
                        className="w-full"
                        onClick={() => state.handleRetryEnhancedSession(session.id)}
                      >
                        {state.t("重试连接", "Retry")}
                      </Button>
                    ) : null}
                    <Button variant="ghost" lightMode={!state.isDark} className="w-full" onClick={() => state.handleDisconnectOrDelete(session)}>
                      {session.status === "active" ? state.t("断开", "Disconnect") : state.t("删除", "Delete")}
                    </Button>
                  </div>
                  {state.showSessionStatusSummary && session.status === "active" ? (
                    <SessionStatusSummary
                      entry={state.sessionStatusEntries[session.id]}
                      isDark={state.isDark}
                      t={state.t}
                    />
                  ) : null}
                  <div className="space-y-2">
                    <Input
                      placeholder={state.t("备注", "Note")}
                      value={noteValue}
                      maxLength={1000}
                      onChange={(event) => state.handleNoteChange(session.id, event.target.value)}
                      className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                    />
                    <div className={`flex items-center justify-between text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
                      <span>{state.t("最多 1000 字", "Up to 1000 characters")}</span>
                      {noteValue.trim() !== (session.note ?? "") ? (
                        <Button
                          variant="secondary"
                          lightMode={!state.isDark}
                          onClick={() => state.handleSaveNote(session)}
                          className="px-3 py-2 text-xs"
                        >
                          {state.t("保存备注", "Save note")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {state.filteredSessions.length === 0 ? (
            <div className={`text-sm ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>{state.t("暂无会话", "No sessions")}</div>
          ) : null}
        </div>

        <SessionsConnectionsPanel state={state} />
      </div>

      <SessionsDialogs state={state} />
    </div>
  );
}
