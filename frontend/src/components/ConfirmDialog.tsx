import React from "react";
import { Button } from "./Button";
import { useApp } from "../context/AppContextCore";

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

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    return element.getAttribute("aria-hidden") !== "true";
  });
}

function focusDialogContent(dialog: HTMLDivElement | null) {
  if (!dialog) {
    return;
  }

  const firstFocusable = getFocusableElements(dialog)[0];
  (firstFocusable ?? dialog).focus();
}

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
  const titleId = React.useId();
  const descriptionId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = window.requestAnimationFrame(() => {
      focusDialogContent(dialogRef.current);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      const previousFocus = previousFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
      previousFocusRef.current = null;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const activeElement = document.activeElement;
      if (getFocusableElements(dialog).length === 0 || !(activeElement instanceof HTMLElement) || !dialog.contains(activeElement)) {
        focusDialogContent(dialog);
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [open, loading]);

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

  const handleDialogKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    const focusableElements = getFocusableElements(dialog);
    if (!dialog || focusableElements.length === 0) {
      event.preventDefault();
      dialog?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (activeElement === firstElement || !focusableElements.includes(activeElement as HTMLElement)) {
        event.preventDefault();
        lastElement.focus();
      }
      return;
    }

    if (activeElement === lastElement || !focusableElements.includes(activeElement as HTMLElement)) {
      event.preventDefault();
      firstElement.focus();
    }
  }, []);

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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className={`relative z-10 w-full max-w-md rounded-lg p-6 shadow-xl ${
          isDark ? "bg-slate-800" : "bg-white"
        }`}
      >
        <h3
          id={titleId}
          className={`text-lg font-semibold mb-2 ${
            isDark ? "text-slate-100" : "text-slate-900"
          }`}
        >
          {title}
        </h3>
        <p
          id={descriptionId}
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
