import React from "react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Input } from "../../components/Input";
import type { SessionsState } from "./useSessionsState";

type SessionsDialogsProps = {
  state: SessionsState;
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

function trapDialogFocus(event: React.KeyboardEvent<HTMLDivElement>, dialog: HTMLDivElement | null) {
  if (event.key !== "Tab") {
    return;
  }

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
}

export function SessionsDialogs({ state }: SessionsDialogsProps) {
  const passwordTitleId = React.useId();
  const passwordDescriptionId = React.useId();
  const currentPasswordId = React.useId();
  const newPasswordId = React.useId();
  const confirmPasswordId = React.useId();
  const enhanceTitleId = React.useId();
  const enhanceDescriptionId = React.useId();
  const enhanceDetailsId = React.useId();
  const passwordDialogRef = React.useRef<HTMLDivElement | null>(null);
  const enhanceDialogRef = React.useRef<HTMLDivElement | null>(null);
  const previousPasswordFocusRef = React.useRef<HTMLElement | null>(null);
  const previousEnhanceFocusRef = React.useRef<HTMLElement | null>(null);
  const closePasswordDialogRef = React.useRef(state.handleClosePasswordDialog);
  const passwordSavingRef = React.useRef(state.passwordSaving);
  const closeEnhanceDialogRef = React.useRef(() => state.setEnhancePrompt(null));
  const passwordDialogOpen = state.passwordDialogOpen;
  const enhanceDialogOpen = Boolean(state.enhancePrompt?.open);
  const fieldLabelClassName = `mb-1 block text-xs font-medium ${state.isDark ? "text-slate-300" : "text-slate-700"}`;

  closePasswordDialogRef.current = state.handleClosePasswordDialog;
  passwordSavingRef.current = state.passwordSaving;
  closeEnhanceDialogRef.current = () => state.setEnhancePrompt(null);

  React.useEffect(() => {
    if (!passwordDialogOpen) {
      return;
    }

    previousPasswordFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = window.requestAnimationFrame(() => {
      passwordDialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      const previousFocus = previousPasswordFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
      previousPasswordFocusRef.current = null;
    };
  }, [passwordDialogOpen]);

  React.useEffect(() => {
    if (!enhanceDialogOpen) {
      return;
    }

    previousEnhanceFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = window.requestAnimationFrame(() => {
      const firstControl = enhanceDialogRef.current?.querySelector<HTMLElement>("input, button:not(:disabled)");
      firstControl?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      const previousFocus = previousEnhanceFocusRef.current;
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
      previousEnhanceFocusRef.current = null;
    };
  }, [enhanceDialogOpen]);

  React.useEffect(() => {
    if (!passwordDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !passwordSavingRef.current) {
        closePasswordDialogRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [passwordDialogOpen]);

  React.useEffect(() => {
    if (!enhanceDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeEnhanceDialogRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enhanceDialogOpen]);

  return (
    <>
      <ConfirmDialog
        open={state.deleteConfirm !== null}
        title={state.deleteConfirm?.type === "session" ? state.t("删除会话", "Delete session") : state.t("删除连接", "Delete connection")}
        message={state.t(`确定要删除 "${state.deleteConfirm?.name ?? ""}" 吗？此操作不可撤销。`, `Are you sure you want to delete "${state.deleteConfirm?.name ?? ""}"? This action cannot be undone.`)}
        confirmText={state.t("删除", "Delete")}
        variant="danger"
        loading={state.deleteLoading}
        onConfirm={state.confirmDelete}
        onCancel={() => state.setDeleteConfirm(null)}
      />

      {passwordDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !state.passwordSaving) {
              state.handleClosePasswordDialog();
            }
          }}
        >
          <div
            ref={passwordDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={passwordTitleId}
            aria-describedby={passwordDescriptionId}
            tabIndex={-1}
            onKeyDown={(event) => trapDialogFocus(event, passwordDialogRef.current)}
            className={`w-full max-w-md rounded-xl border p-6 shadow-xl ${state.isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
          >
            <h3 id={passwordTitleId} className="mb-2 text-lg font-semibold">{state.t("修改密码", "Change password")}</h3>
            <p id={passwordDescriptionId} className={`mb-4 text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
              {state.t("请输入当前密码，并设置新的登录密码。", "Enter your current password and set a new login password.")}
            </p>
            <div className="space-y-3">
              <div>
                <label htmlFor={currentPasswordId} className={fieldLabelClassName}>
                  {state.t("当前密码", "Current password")}
                </label>
                <Input
                  id={currentPasswordId}
                  placeholder={state.t("输入当前密码", "Enter current password")}
                  type="password"
                  value={state.passwordForm.currentPassword}
                  onChange={(event) => state.setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                  className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
              </div>
              <div>
                <label htmlFor={newPasswordId} className={fieldLabelClassName}>
                  {state.t("新密码", "New password")}
                </label>
                <Input
                  id={newPasswordId}
                  placeholder={state.t("输入新密码", "Enter new password")}
                  type="password"
                  value={state.passwordForm.newPassword}
                  onChange={(event) => state.setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                  className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
              </div>
              <div>
                <label htmlFor={confirmPasswordId} className={fieldLabelClassName}>
                  {state.t("确认新密码", "Confirm new password")}
                </label>
                <Input
                  id={confirmPasswordId}
                  placeholder={state.t("再次输入新密码", "Confirm new password")}
                  type="password"
                  value={state.passwordForm.confirmPassword}
                  onChange={(event) => state.setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                  className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="ghost"
                lightMode={!state.isDark}
                onClick={state.handleClosePasswordDialog}
                disabled={state.passwordSaving}
              >
                {state.t("取消", "Cancel")}
              </Button>
              <Button
                variant="primary"
                lightMode={!state.isDark}
                loading={state.passwordSaving}
                onClick={state.handleSubmitPasswordChange}
              >
                {state.t("确认修改", "Update password")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {enhanceDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              state.setEnhancePrompt(null);
            }
          }}
        >
          <div
            ref={enhanceDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={enhanceTitleId}
            aria-describedby={`${enhanceDescriptionId} ${enhanceDetailsId}`}
            tabIndex={-1}
            onKeyDown={(event) => trapDialogFocus(event, enhanceDialogRef.current)}
            className={`w-full max-w-lg rounded-xl border p-6 shadow-xl ${state.isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}
          >
            <h3 id={enhanceTitleId} className="text-lg font-semibold mb-2">{state.t("是否开启增强持久化连接", "Enable enhanced persistent connection?")}</h3>
            <p id={enhanceDescriptionId} className={`text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
              {state.t(
                `检测到远端系统为 ${state.enhancePrompt.remoteOs || "unknown"} (${state.enhancePrompt.remoteArch || "unknown"})，建议开启增强持久化连接以提高稳定性。`,
                `Detected remote system ${state.enhancePrompt.remoteOs || "unknown"} (${state.enhancePrompt.remoteArch || "unknown"}). Enable enhanced persistence for better stability.`
              )}
            </p>
            <label className={`mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${state.isDark ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-slate-50"}`}>
              <input
                type="checkbox"
                checked={state.enhancePrompt.checked}
                onChange={(event) => state.setEnhancePrompt((prev) => (prev ? { ...prev, checked: event.target.checked } : prev))}
              />
              <span>{state.t("开启增强持久化连接", "Enable enhanced persistent connection")}</span>
            </label>
            <div id={enhanceDetailsId} className={`mt-3 text-xs ${state.isDark ? "text-slate-500" : "text-slate-500"}`}>
              {state.t(
                "普通连接的可靠性由项目所在机器和目标之间的网络决定。开启此功能会向目标机器搭建 tmux 通道，防止网络波动造成的连接断开。",
                "Normal connections depend on network stability between this host and the target. Enabling this will create a tmux channel to keep the session alive during network fluctuations."
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="ghost"
                lightMode={!state.isDark}
                onClick={() => state.setEnhancePrompt(null)}
              >
                {state.t("取消", "Cancel")}
              </Button>
              <Button
                variant="primary"
                lightMode={!state.isDark}
                onClick={state.handleConfirmEnhance}
              >
                {state.t("确认连接", "Confirm connection")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
