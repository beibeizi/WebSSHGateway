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
          <SessionViewModeToggle
            value={state.viewMode}
            onChange={state.setViewMode}
            isDark={state.isDark}
            t={state.t}
            fullWidth
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
                className="min-h-11 px-3 py-2 text-xs whitespace-nowrap"
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
              className="min-h-11 px-3 py-2 text-xs whitespace-nowrap"
            >
              {state.t("系统设置", "System Settings")}
            </Button>
            <Button
              variant="secondary"
              lightMode={!state.isDark}
              onClick={() => {
                window.location.href = "/logs";
              }}
              className="min-h-11 px-3 py-2 text-xs whitespace-nowrap"
            >
              <FileText className="h-4 w-4" />
              {state.t("日志", "Logs")}
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          {state.viewMode === "grouped" ? (
            <SessionGroupedList state={state} layout="mobile" />
          ) : (
            <>
              {state.filteredSessions.map((session) => (
                <SessionCard key={session.id} state={state} session={session} layout="mobile" />
              ))}
              {state.filteredSessions.length === 0 ? <SessionEmptyState state={state} /> : null}
            </>
          )}
        </div>

        <SessionsConnectionsPanel state={state} />
      </div>

      <SessionsDialogs state={state} />
    </div>
  );
}
