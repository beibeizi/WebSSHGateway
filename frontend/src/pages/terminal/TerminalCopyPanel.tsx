import React from "react";
import { Copy, X } from "lucide-react";
import { Button } from "../../components/Button";
import type { TerminalBufferSnapshot } from "./terminalUtils";

type TerminalCopyPanelProps = {
  snapshot: TerminalBufferSnapshot;
  isDark: boolean;
  t: (zh: string, en: string) => string;
  onCopy: (text: string) => Promise<boolean>;
  onClose: () => void;
};

type SelectionRange = {
  start: number;
  end: number;
};

type CopyTarget = "selection" | "all";

export function TerminalCopyPanel({
  snapshot,
  isDark,
  t,
  onCopy,
  onClose,
}: TerminalCopyPanelProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = React.useState<SelectionRange>({ start: 0, end: 0 });
  const [copying, setCopying] = React.useState<CopyTarget | null>(null);

  const syncSelection = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    setSelection({
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
  }, []);

  const restoreSelection = React.useCallback((range: SelectionRange) => {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(range.start, range.end);
      setSelection(range);
    });
  }, []);

  const copyValue = React.useCallback(async (target: CopyTarget) => {
    const textarea = textareaRef.current;
    const currentSelection = textarea
      ? { start: textarea.selectionStart, end: textarea.selectionEnd }
      : selection;
    const value = target === "all"
      ? snapshot.text
      : snapshot.text.slice(currentSelection.start, currentSelection.end);
    if (!value) {
      return;
    }

    setCopying(target);
    try {
      await onCopy(value);
    } finally {
      setCopying(null);
      restoreSelection(currentSelection);
    }
  }, [onCopy, restoreSelection, selection, snapshot.text]);

  const selectedText = snapshot.text.slice(selection.start, selection.end);
  const snapshotRangeLabel = snapshot.truncated
    ? t(`最近 ${snapshot.loadedLines} 行`, `Latest ${snapshot.loadedLines} rows`)
    : t(`${snapshot.loadedLines} 行`, `${snapshot.loadedLines} rows`);

  return (
    <section
      aria-label={t("终端选择复制", "Terminal selection copy")}
      className={`absolute inset-3 z-20 flex min-h-0 flex-col overflow-hidden rounded-lg border ${
        isDark
          ? "border-slate-700 bg-slate-950 text-slate-100"
          : "border-slate-300 bg-white text-slate-900"
      }`}
    >
      <div className={`flex min-h-11 items-center gap-2 border-b px-3 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {t("选择复制", "Select and copy")}
          </div>
          <div className={`flex items-center gap-2 text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>
            <span>{snapshotRangeLabel}</span>
            {snapshot.truncated ? (
              <span className={isDark ? "text-amber-300" : "text-amber-700"}>
                {t("已截断", "Truncated")}
              </span>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          lightMode={!isDark}
          onClick={onClose}
          className="h-11 w-11 shrink-0 p-0"
          aria-label={t("关闭选择复制", "Close selection copy")}
          title={t("关闭", "Close")}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      <textarea
        ref={textareaRef}
        value={snapshot.text}
        readOnly
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onSelect={syncSelection}
        onKeyUp={syncSelection}
        onPointerUp={syncSelection}
        onTouchEnd={syncSelection}
        aria-label={t("终端输出快照", "Terminal output snapshot")}
        placeholder={t("暂无可复制的终端输出", "No terminal output to copy")}
        className={`min-h-0 flex-1 w-full resize-none px-3 py-3 font-mono text-base leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 ${
          isDark
            ? "bg-slate-950 text-slate-100 placeholder:text-slate-400"
            : "bg-white text-slate-900 placeholder:text-slate-600"
        }`}
        style={{
          WebkitTouchCallout: "default",
          WebkitUserSelect: "text",
          userSelect: "text",
          touchAction: "pan-y",
        }}
      />

      <div className={`grid grid-cols-2 gap-2 border-t p-2 ${isDark ? "border-slate-800" : "border-slate-200"}`}>
        <Button
          type="button"
          variant="secondary"
          lightMode={!isDark}
          loading={copying === "selection"}
          disabled={copying !== null || !selectedText}
          onClick={() => void copyValue("selection")}
          className="min-h-11 min-w-0 px-2 text-xs"
        >
          <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 leading-tight">{t("复制所选", "Copy selection")}</span>
        </Button>
        <Button
          type="button"
          variant="primary"
          lightMode={!isDark}
          loading={copying === "all"}
          disabled={copying !== null || !snapshot.text}
          onClick={() => void copyValue("all")}
          className="min-h-11 min-w-0 px-2 text-xs"
        >
          <Copy className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 leading-tight">{t("复制全部", "Copy all")}</span>
        </Button>
      </div>
    </section>
  );
}
