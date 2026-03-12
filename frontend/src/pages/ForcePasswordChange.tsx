import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { useToast } from "../components/Toast";
import { changePassword, clearAuthStorage } from "../lib/api";

export function ForcePasswordChange() {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();
  const { push } = useToast();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      push("密码已更新，请重新登录");
      clearAuthStorage();
      navigate("/");
    } catch (error) {
      push(error instanceof Error ? error.message : "修改失败");
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = !currentPassword || !newPassword || !confirmPassword || loading;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <Card title="首次登录修改密码" description="新密码至少 8 位，包含大小写字母和数字。">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">当前密码</label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">新密码</label>
            <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">确认新密码</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          <Button disabled={isDisabled} type="submit" className="w-full">
            {loading ? "提交中..." : "更新密码"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
