import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import type { SessionsState } from "./useSessionsState";
import { SessionsConnectionsPanel } from "./SessionsConnectionsPanel";
import { SessionsDialogs } from "./SessionsDialogs";
import { SessionStatusSummary } from "./SessionStatusSummary";
import { SessionStatusToggle } from "./SessionStatusToggle";
import { clearAuthStorage } from "../../lib/api";

type SessionsDesktopProps = {
  state: SessionsState;
};

export function SessionsDesktop({ state }: SessionsDesktopProps) {
  if (state.loading) {
    return <div className={`p-6 ${state.isDark ? "text-slate-200" : "text-slate-700"}`}>{state.t("加载中...", "Loading...")}</div>;
  }

  return (
    <div className={`min-h-screen px-6 py-8 transition-colors duration-300 ${state.isDark ? "bg-slate-950 text-slate-100 dark-scrollbar" : "bg-gray-100 text-slate-900 light-scrollbar"}`}>
      <div className="mx-auto max-w-6xl space-y-8">
        <div className={`flex items-center justify-between pb-6 ${state.isDark ? "border-b border-slate-700" : "border-b border-slate-200"}`}>
          <div>
            <h1 className="text-2xl font-semibold">{state.t("会话管理", "Session Management")}</h1>
            <p className={`text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
              {state.t("管理 SSH 连接与持久在线会话", "Manage SSH connections and persistent sessions")}
              <a
                href="https://github.com/beibeizi/WebSSHGateway"
                target="_blank"
                rel="noreferrer"
                className={`ml-2 inline-flex items-center gap-2 align-middle ${
                  state.isDark ? "text-slate-300 hover:text-slate-200" : "text-slate-600 hover:text-slate-700"
                }`}
                aria-label={state.t("打开 GitHub 仓库", "Open GitHub repository")}
                title={state.t("打开 GitHub 仓库", "Open GitHub repository")}
              >
                <img
                  src="https://img.shields.io/github/stars/beibeizi/WebSSHGateway?style=social"
                  alt={state.t("GitHub Star 数", "GitHub stars")}
                  className="h-4"
                  loading="lazy"
                />
              </a>
            </p>
            <p className={`text-xs mt-1 ${state.networkProfileTone}`}>{state.networkProfileLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              lightMode={!state.isDark}
              onClick={state.toggleLanguage}
            >
              {state.language === "en-US" ? "中文" : "EN"}
            </Button>
            <Button
              variant="ghost"
              lightMode={!state.isDark}
              onClick={state.toggleTheme}
            >
              {state.isDark ? state.t("浅色", "Light") : state.t("深色", "Dark")}
            </Button>
            <Button
              variant="secondary"
              lightMode={!state.isDark}
              onClick={() => state.setPasswordDialogOpen(true)}
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
            >
              {state.t("退出登录", "Sign out")}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder={state.t("搜索会话名称", "Search session name")}
                value={state.search}
                onChange={(event) => state.setSearch(event.target.value)}
                className={`max-w-xs ${state.isDark ? "" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
              />
              <div className="flex gap-2">
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
                  >
                    {item.label}
                  </Button>
                ))}
                <SessionStatusToggle
                  checked={state.showSessionStatusSummary}
                  onChange={() => state.setShowSessionStatusSummary((prev: boolean) => !prev)}
                  isDark={state.isDark}
                  label={state.t("系统状态", "System Status")}
                />
              </div>
            </div>

            <div className="grid gap-4">
              {state.filteredSessions.map((session) => {
                const noteValue = state.noteDrafts[session.id] ?? "";
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
                    onDragOver={(event) => state.ordering.handleDragOver(session.id, event)}
                    onDrop={(event) => event.preventDefault()}
                    className={`relative rounded-lg border p-4 pl-14 transition-transform duration-200 ease-out will-change-transform ${
                      state.ordering.draggingSessionId === session.id ? "ring-2 ring-indigo-400/60" : ""
                    } ${state.isDark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white shadow-sm"}`}
                  >
                    <button
                      type="button"
                      draggable={!state.ordering.savingOrder}
                      onDragStart={(event) => state.ordering.handleDragStart(session.id, event)}
                      onDragEnd={state.ordering.handleDragEnd}
                      disabled={state.ordering.savingOrder}
                      aria-label={state.t("拖动调整排序", "Drag to reorder")}
                      title={state.t("拖动调整排序", "Drag to reorder")}
                      className={`absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border p-2 shadow-sm transition ${
                        state.isDark
                          ? "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"
                          : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                      } ${state.ordering.savingOrder ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing"}`}
                    >
                      <span className="flex flex-col items-center leading-none">
                        <ChevronUp className="h-4 w-4 -mb-1" />
                        <ChevronDown className="h-4 w-4 -mt-1" />
                      </span>
                    </button>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1">
                        <p className="text-lg font-semibold">{session.name}</p>
                        <p className={`text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {session.username}@{session.host}
                        </p>
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
                            {state.t("本轮重试", "Retry cycle")}: {session.retry_cycle_count ?? 0}/5
                          </p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        {session.status === "active" ? (
                          <Button variant="secondary" lightMode={!state.isDark} onClick={() => window.open(`/terminal/${session.id}`, "_blank")}>
                            {state.t("打开会话", "Open session")}
                          </Button>
                        ) : null}
                        {session.enhanced_enabled && session.status !== "active" && session.allow_auto_retry !== false ? (
                          <Button
                            variant="secondary"
                            lightMode={!state.isDark}
                            loading={state.isSystemRetrying(session) || !!state.retryingSessionIds[session.id]}
                            onClick={() => state.handleRetryEnhancedSession(session.id)}
                          >
                            {state.t("重试连接", "Retry")}
                          </Button>
                        ) : null}
                        <Button variant="ghost" lightMode={!state.isDark} onClick={() => state.handleDisconnectOrDelete(session)}>
                          {session.status === "active" ? state.t("断开", "Disconnect") : state.t("删除", "Delete")}
                        </Button>
                      </div>
                    </div>
                    {state.showSessionStatusSummary && session.status === "active" ? (
                      <div className="mt-4">
                        <SessionStatusSummary
                          entry={state.sessionStatusEntries[session.id]}
                          isDark={state.isDark}
                          t={state.t}
                        />
                      </div>
                    ) : null}
                    <div className="mt-4 space-y-2">
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
                          >
                            {state.t("保存备注", "Save note")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {state.filteredSessions.length === 0 ? (
                <div className={`text-sm ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>{state.t("暂无会话", "No sessions")}</div>
              ) : null}
            </div>
          </div>

          <SessionsConnectionsPanel state={state} />
        </div>
      </div>

      <SessionsDialogs state={state} />
    </div>
  );
}
