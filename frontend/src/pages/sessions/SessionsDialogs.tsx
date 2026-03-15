import React from "react";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Input } from "../../components/Input";
import type { SessionsState } from "./useSessionsState";

type SessionsDialogsProps = {
  state: SessionsState;
};

export function SessionsDialogs({ state }: SessionsDialogsProps) {
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

      {state.passwordDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className={`w-full max-w-md rounded-xl border p-6 shadow-xl ${state.isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
            <h3 className="mb-2 text-lg font-semibold">{state.t("修改密码", "Change password")}</h3>
            <p className={`mb-4 text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
              {state.t("请输入当前密码，并设置新的登录密码。", "Enter your current password and set a new login password.")}
            </p>
            <div className="space-y-3">
              <Input
                placeholder={state.t("当前密码", "Current password")}
                type="password"
                value={state.passwordForm.currentPassword}
                onChange={(event) => state.setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
              />
              <Input
                placeholder={state.t("新密码", "New password")}
                type="password"
                value={state.passwordForm.newPassword}
                onChange={(event) => state.setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
              />
              <Input
                placeholder={state.t("确认新密码", "Confirm new password")}
                type="password"
                value={state.passwordForm.confirmPassword}
                onChange={(event) => state.setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
              />
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

      {state.enhancePrompt?.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className={`w-full max-w-lg rounded-xl border p-6 shadow-xl ${state.isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>
            <h3 className="text-lg font-semibold mb-2">{state.t("是否开启增强持久化连接", "Enable enhanced persistent connection?")}</h3>
            <p className={`text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
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
            <div className={`mt-3 text-xs ${state.isDark ? "text-slate-500" : "text-slate-500"}`}>
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
