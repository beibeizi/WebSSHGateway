import React from "react";
import { cn } from "../lib/utils";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  /** @deprecated 使用 ThemeAwareButton 或让组件自动检测主题 */
  lightMode?: boolean;
};

const darkVariants: Record<string, string> = {
  primary: "bg-indigo-500 text-white hover:bg-indigo-400 shadow-sm",
  secondary: "bg-slate-700 text-slate-100 hover:bg-slate-600 shadow-sm border border-slate-600",
  ghost: "bg-slate-800/50 text-slate-200 hover:bg-slate-700 border border-slate-600 shadow-sm",
  danger: "bg-rose-600 text-white hover:bg-rose-500 shadow-sm"
};

const lightVariants: Record<string, string> = {
  primary: "bg-indigo-500 text-white hover:bg-indigo-400 shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 shadow-sm",
  ghost: "bg-white text-slate-700 hover:bg-slate-100 border border-slate-300 shadow-sm",
  danger: "bg-rose-600 text-white hover:bg-rose-500 shadow-sm"
};

function LoadingSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// 基础按钮（需要手动指定 lightMode）
export function Button({
  variant = "primary",
  loading = false,
  lightMode = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const variantStyles = lightMode ? lightVariants : darkVariants;

  return (
    <button
      className={cn(
        "rounded-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 inline-flex items-center justify-center gap-2",
        variantStyles[variant],
        (loading || disabled) && "opacity-60 cursor-not-allowed",
        className
      )}
      disabled={loading || disabled}
      {...props}
    >
      {loading ? <LoadingSpinner /> : null}
      {children}
    </button>
  );
}

// 自动感知主题的按钮组件
export type ThemeAwareButtonProps = Omit<ButtonProps, "lightMode"> & {
  isDark: boolean;
};

export function ThemeAwareButton({
  variant = "primary",
  loading = false,
  isDark,
  className,
  disabled,
  children,
  ...props
}: ThemeAwareButtonProps) {
  const variantStyles = isDark ? darkVariants : lightVariants;

  return (
    <button
      className={cn(
        "rounded-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 inline-flex items-center justify-center gap-2",
        variantStyles[variant],
        (loading || disabled) && "opacity-60 cursor-not-allowed",
        className
      )}
      disabled={loading || disabled}
      {...props}
    >
      {loading ? <LoadingSpinner /> : null}
      {children}
    </button>
  );
}

