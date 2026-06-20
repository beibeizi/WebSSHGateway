import React from "react";
import { cn } from "../../lib/utils";

type SessionStatusChipProps = {
  status: string;
  label: string;
  isDark: boolean;
};

function getSessionStatusClassName(status: string, isDark: boolean) {
  if (status === "active") {
    return isDark
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "disconnected") {
    return isDark
      ? "border-slate-600 bg-slate-800/80 text-slate-300"
      : "border-slate-200 bg-slate-100 text-slate-600";
  }

  return isDark
    ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

function getSessionStatusDotClassName(status: string, isDark: boolean) {
  if (status === "active") {
    return isDark ? "bg-emerald-300" : "bg-emerald-500";
  }

  if (status === "disconnected") {
    return isDark ? "bg-slate-500" : "bg-slate-400";
  }

  return isDark ? "bg-amber-300" : "bg-amber-500";
}

export function SessionStatusChip({ status, label, isDark }: SessionStatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold",
        getSessionStatusClassName(status, isDark)
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", getSessionStatusDotClassName(status, isDark))}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
