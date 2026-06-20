import React from "react";
import { cn } from "../../lib/utils";
import type { SessionsState } from "./useSessionsState";

type SessionEmptyStateProps = {
  state: SessionsState;
};

export function SessionEmptyState({ state }: SessionEmptyStateProps) {
  const hasActiveFilter = Boolean(state.search) || state.filter !== "all";
  const title = hasActiveFilter
    ? state.viewMode === "grouped"
      ? state.t("没有匹配的分组", "No matching groups")
      : state.t("没有匹配的会话", "No matching sessions")
    : state.viewMode === "grouped"
      ? state.t("还没有会话分组", "No session groups yet")
      : state.t("还没有会话", "No sessions yet");

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-6 text-sm",
        state.isDark
          ? "border-slate-700 bg-slate-900/50 text-slate-400"
          : "border-slate-200 bg-white text-slate-500 shadow-sm"
      )}
    >
      <p className={`font-semibold ${state.isDark ? "text-slate-200" : "text-slate-800"}`}>
        {title}
      </p>
      <p className="mt-1">
        {hasActiveFilter
          ? state.t("调整搜索词或状态筛选后重试。", "Adjust the search term or status filter and try again.")
          : state.t("从已保存连接启动会话，或先新增 SSH 连接。", "Start a session from a saved connection, or add an SSH connection first.")}
      </p>
    </div>
  );
}
