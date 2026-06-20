import React from "react";
import { FileText } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import type { SessionsState } from "./useSessionsState";
import { SessionsConnectionsPanel } from "./SessionsConnectionsPanel";
import { SessionsDialogs } from "./SessionsDialogs";
import { clearAuthStorage } from "../../lib/api";
import { SessionCard } from "./SessionCard";
import { SessionEmptyState } from "./SessionEmptyState";
import { SessionGroupedList } from "./SessionGroupedList";
import { SessionViewModeToggle } from "./SessionViewModeToggle";

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
              <SessionViewModeToggle
                value={state.viewMode}
                onChange={state.setViewMode}
                isDark={state.isDark}
                t={state.t}
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
                <Button
                  variant="secondary"
                  lightMode={!state.isDark}
                  onClick={() => {
                    window.location.href = "/settings";
                  }}
                >
                  {state.t("系统设置", "System Settings")}
                </Button>
                <Button
                  variant="secondary"
                  lightMode={!state.isDark}
                  onClick={() => {
                    window.location.href = "/logs";
                  }}
                >
                  <FileText className="h-4 w-4" />
                  {state.t("日志", "Logs")}
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              {state.viewMode === "grouped" ? (
                <SessionGroupedList state={state} layout="desktop" />
              ) : (
                <>
                  {state.filteredSessions.map((session) => (
                    <SessionCard key={session.id} state={state} session={session} layout="desktop" />
                  ))}
                  {state.filteredSessions.length === 0 ? <SessionEmptyState state={state} /> : null}
                </>
              )}
            </div>
          </div>

          <SessionsConnectionsPanel state={state} />
        </div>
      </div>

      <SessionsDialogs state={state} />
    </div>
  );
}
