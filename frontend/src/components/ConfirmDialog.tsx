import React from "react";
import { Button } from "./Button";
import { useApp } from "../context/AppContext";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  variant = "default",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { isDark } = useApp();

  // 澶勭悊 ESC 閿叧闂?
  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && !loading) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, loading, onCancel]);

  if (!open) return null;

  // 确认按钮使用 danger 变体或默认 primary
  const confirmVariant = variant === "danger" ? "danger" : "primary";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !loading && onCancel()}
      />

      {/* 瀵硅瘽妗?*/}
      <div
        className={`relative z-10 w-full max-w-md rounded-lg p-6 shadow-xl ${
          isDark ? "bg-slate-800" : "bg-white"
        }`}
      >
        <h3
          className={`text-lg font-semibold mb-2 ${
            isDark ? "text-slate-100" : "text-slate-900"
          }`}
        >
          {title}
        </h3>
        <p
          className={`mb-6 ${isDark ? "text-slate-300" : "text-slate-600"}`}
        >
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <Button
            variant="secondary"
            lightMode={!isDark}
            onClick={onCancel}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant={confirmVariant}
            lightMode={!isDark}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
