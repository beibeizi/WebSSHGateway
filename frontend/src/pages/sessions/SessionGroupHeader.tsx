import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Connection, Session } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { SessionGroup } from "./sessionsUtils";
import { formatBytesPerSecond } from "./sessionsUtils";
import type { SessionsState } from "./useSessionsState";

type SessionGroupHeaderProps = {
  state: SessionsState;
  group: SessionGroup<Session, Connection>;
  expanded: boolean;
  onToggle: () => void;
};

function getProbeStatusLabel(state: SessionsState, status?: string | null) {
  if (status === "verifying") return state.t("验证中", "Verifying");
  if (status === "verified") return state.t("已验证", "Verified");
  if (status === "failed") return state.t("验证失败", "Verification failed");
  if (status === "stale") return state.t("可能已过期", "May be stale");
  return state.t("未验证", "Unverified");
}

function getProbeStatusClassName(state: SessionsState, status?: string | null) {
  if (status === "verified") {
    return state.isDark ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "failed") {
    return state.isDark ? "border-rose-400/40 bg-rose-500/10 text-rose-200" : "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "stale") {
    return state.isDark ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "verifying") {
    return state.isDark ? "border-sky-400/40 bg-sky-500/10 text-sky-200" : "border-sky-200 bg-sky-50 text-sky-700";
  }
  return state.isDark ? "border-slate-600 bg-slate-800 text-slate-300" : "border-slate-200 bg-slate-100 text-slate-600";
}

function formatConnectionEndpoint(group: SessionGroup<Session, Connection>) {
  const firstSession = group.sessions[0];
  const username = group.connection?.username ?? firstSession?.username ?? "-";
  const host = group.connection?.host ?? firstSession?.host ?? "-";
  const port = group.connection?.port;
  return port ? `${username}@${host}:${port}` : `${username}@${host}`;
}

function SessionGroupSystemPreview({ state, group }: { state: SessionsState; group: SessionGroup<Session, Connection> }) {
  const activeSession = group.representativeActiveSession;
  const mutedClassName = state.isDark ? "text-slate-400" : "text-slate-500";

  if (!activeSession) {
    return <span className={mutedClassName}>{state.t("无在线采集", "No online collection")}</span>;
  }

  if (!state.showSessionStatusSummary) {
    return <span className={mutedClassName}>{state.t("状态摘要已关闭", "Status summary disabled")}</span>;
  }

  const entry = state.sessionStatusEntries[activeSession.id];
  if (!entry || (entry.loading && !entry.summary)) {
    return <span className={mutedClassName}>{state.t("状态采集中", "Collecting status")}</span>;
  }

  if (!entry.summary) {
    return <span className={mutedClassName}>{state.t("采集暂不可用", "Collection unavailable")}</span>;
  }

  const { stats, network } = entry.summary;
  const metricClassName = state.isDark ? "text-slate-200" : "text-slate-700";
  const hint = entry.error
    ? state.t("上次采集", "Last sample")
    : entry.loading
      ? state.t("刷新中", "Refreshing")
      : "";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={metricClassName}>CPU {stats.cpu.percent.toFixed(1)}%</span>
      <span className={metricClassName}>{state.t("内存", "Memory")} {stats.memory.percent.toFixed(1)}%</span>
      <span className={state.isDark ? "text-emerald-300" : "text-emerald-600"}>
        ↑ {formatBytesPerSecond(network.upload_speed)}
      </span>
      <span className={state.isDark ? "text-sky-300" : "text-sky-600"}>
        ↓ {formatBytesPerSecond(network.download_speed)}
      </span>
      {hint ? <span className={`text-[11px] ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>{hint}</span> : null}
    </div>
  );
}

export function SessionGroupHeader({ state, group, expanded, onToggle }: SessionGroupHeaderProps) {
  const connectionName = group.connection?.name ?? group.sessions[0]?.name ?? state.t("未知连接", "Unknown connection");
  const lastActivity = group.lastActivity ? new Date(group.lastActivity).toLocaleString() : "-";

  return (
    <button
      type="button"
      className={cn(
        "w-full px-4 py-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400",
        state.isDark ? "hover:bg-slate-900/80" : "hover:bg-slate-50"
      )}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <span
            className={cn(
              "mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border",
              state.isDark ? "border-slate-700 bg-slate-950 text-slate-300" : "border-slate-200 bg-white text-slate-600"
            )}
            aria-hidden="true"
          >
            {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={`break-words text-base font-semibold ${state.isDark ? "text-slate-100" : "text-slate-900"}`}>
                {connectionName}
              </p>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${getProbeStatusClassName(state, group.connection?.remote_probe_status)}`}>
                {getProbeStatusLabel(state, group.connection?.remote_probe_status)}
              </span>
            </div>
            <p className={`break-all text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
              {formatConnectionEndpoint(group)}
            </p>
            <div className={`flex flex-wrap gap-x-3 gap-y-1 text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
              <span>{state.t("在线", "Active")} {group.activeCount}</span>
              <span>{state.t("离线", "Offline")} {group.offlineCount}</span>
              <span>{state.t("最近活动", "Last activity")}: {lastActivity}</span>
            </div>
          </div>
        </div>
        <div className={`rounded-md border px-3 py-2 text-xs ${state.isDark ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
          <div className={`mb-1 font-medium ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
            {state.t("系统状态", "System status")}
          </div>
          <SessionGroupSystemPreview state={state} group={group} />
        </div>
      </div>
    </button>
  );
}
