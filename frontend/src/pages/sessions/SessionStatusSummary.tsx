import React from "react";
import { cn } from "../../lib/utils";
import type { SessionStatusEntry } from "./useSessionStatusSummary";

type SessionStatusSummaryProps = {
  entry?: SessionStatusEntry;
  isDark: boolean;
  t: (zh: string, en: string) => string;
};

type MetricCardProps = {
  label: string;
  value: string;
  percent?: number;
  isDark: boolean;
  accentClassName: string;
  muted?: boolean;
};

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) {
    return "0 B/s";
  }

  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const base = 1024;
  const unitIndex = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(base)), units.length - 1);
  const value = bytesPerSec / Math.pow(base, unitIndex);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function MetricCard({ label, value, percent, isDark, accentClassName, muted = false }: MetricCardProps) {
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        isDark ? "border-slate-700 bg-slate-950/60" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`text-[11px] uppercase tracking-[0.12em] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
          {label}
        </span>
        <span className={cn("text-sm font-semibold", muted ? (isDark ? "text-slate-400" : "text-slate-500") : "")}>
          {value}
        </span>
      </div>
      {typeof percent === "number" ? (
        <div className={`mt-2 h-1.5 rounded-full ${isDark ? "bg-slate-800" : "bg-slate-200"}`}>
          <div
            className={`h-1.5 rounded-full transition-all duration-300 ${accentClassName}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      ) : (
        <div className={`mt-2 h-1.5 rounded-full ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />
      )}
    </div>
  );
}

export function SessionStatusSummary({ entry, isDark, t }: SessionStatusSummaryProps) {
  if (!entry || (entry.loading && !entry.summary)) {
    return (
      <div className={`rounded-md border px-3 py-3 text-sm ${isDark ? "border-slate-700 bg-slate-950/40 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
        {t("系统状态采集中...", "Loading system status...")}
      </div>
    );
  }

  if (!entry.summary) {
    return (
      <div className={`rounded-md border px-3 py-3 text-sm ${isDark ? "border-slate-700 bg-slate-950/40 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
        {t("系统状态暂不可用", "System status unavailable")}
      </div>
    );
  }

  const { stats, network } = entry.summary;
  const swapEnabled = stats.swap.total > 0;

  return (
    <div className={`rounded-lg border p-3 ${isDark ? "border-slate-700 bg-slate-950/30" : "border-slate-200 bg-slate-50/80"}`}>
      <div className="grid gap-2 md:grid-cols-3">
        <MetricCard
          label="CPU"
          value={`${stats.cpu.percent.toFixed(1)}%`}
          percent={stats.cpu.percent}
          isDark={isDark}
          accentClassName="bg-sky-500"
        />
        <MetricCard
          label={t("内存", "Memory")}
          value={`${stats.memory.percent.toFixed(1)}%`}
          percent={stats.memory.percent}
          isDark={isDark}
          accentClassName="bg-emerald-500"
        />
        <MetricCard
          label={t("交换区", "Swap")}
          value={swapEnabled ? `${stats.swap.percent.toFixed(1)}%` : t("未启用", "Disabled")}
          percent={swapEnabled ? stats.swap.percent : undefined}
          isDark={isDark}
          accentClassName="bg-amber-500"
          muted={!swapEnabled}
        />
        <div className={`rounded-md border px-3 py-2 md:col-span-3 ${isDark ? "border-slate-700 bg-slate-950/60" : "border-slate-200 bg-white"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={`text-[11px] uppercase tracking-[0.12em] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {t("网络", "Network")}
            </span>
            <div className="flex flex-wrap items-center gap-4 text-sm font-medium">
              <span className={isDark ? "text-emerald-300" : "text-emerald-600"}>
                ↑ {formatSpeed(network.upload_speed)}
              </span>
              <span className={isDark ? "text-sky-300" : "text-sky-600"}>
                ↓ {formatSpeed(network.download_speed)}
              </span>
            </div>
          </div>
        </div>
      </div>
      {entry.error ? (
        <p className={`mt-2 text-[11px] ${isDark ? "text-slate-500" : "text-slate-400"}`}>
          {t("本次刷新失败，当前显示上次采集结果", "Refresh failed. Showing the previous result.")}
        </p>
      ) : null}
    </div>
  );
}
