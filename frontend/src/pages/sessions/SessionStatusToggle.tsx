import React from "react";
import { cn } from "../../lib/utils";

type SessionStatusToggleProps = {
  checked: boolean;
  onChange: () => void;
  isDark: boolean;
  label: string;
};

export function SessionStatusToggle({ checked, onChange, isDark, label }: SessionStatusToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition ${
        isDark
          ? "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
      }`}
    >
      <span className="whitespace-nowrap">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-indigo-500" : (isDark ? "bg-slate-700" : "bg-slate-300")
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}
