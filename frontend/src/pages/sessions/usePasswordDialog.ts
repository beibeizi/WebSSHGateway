import React from "react";
import { changePassword } from "../../lib/api";

type UsePasswordDialogOptions = {
  push: (message: string) => void;
  t: (zh: string, en: string) => string;
};

export function usePasswordDialog({ push, t }: UsePasswordDialogOptions) {
  const [passwordDialogOpen, setPasswordDialogOpen] = React.useState(false);
  const [passwordSaving, setPasswordSaving] = React.useState(false);
  const [passwordForm, setPasswordForm] = React.useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const resetPasswordForm = React.useCallback(() => {
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  }, []);

  const handleClosePasswordDialog = React.useCallback(() => {
    if (passwordSaving) {
      return;
    }
    setPasswordDialogOpen(false);
    resetPasswordForm();
  }, [passwordSaving, resetPasswordForm]);

  const handleSubmitPasswordChange = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      push(t("请完整填写密码信息", "Please complete all password fields"));
      return;
    }
    setPasswordSaving(true);
    try {
      await changePassword(
        passwordForm.currentPassword,
        passwordForm.newPassword,
        passwordForm.confirmPassword,
      );
      push(t("密码已更新", "Password updated"));
      setPasswordDialogOpen(false);
      resetPasswordForm();
    } catch (error) {
      push(error instanceof Error ? error.message : t("修改失败", "Update failed"));
    } finally {
      setPasswordSaving(false);
    }
  };

  return {
    passwordDialogOpen,
    setPasswordDialogOpen,
    passwordSaving,
    passwordForm,
    setPasswordForm,
    handleClosePasswordDialog,
    handleSubmitPasswordChange,
  };
}
