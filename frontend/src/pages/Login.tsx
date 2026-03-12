import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { useToast } from "../components/Toast";
import { confirmPasswordReset, login, requestPasswordReset, storeAuthData } from "../lib/api";
import { parseJwt } from "../lib/auth";

export function Login() {
  const [username, setUsername] = React.useState("admin");
  const [password, setPassword] = React.useState("");
  const [rememberMe, setRememberMe] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false);
  const [resetUsername, setResetUsername] = React.useState("");
  const [verificationCode, setVerificationCode] = React.useState("");
  const [resetExpiresInSeconds, setResetExpiresInSeconds] = React.useState<number | null>(null);
  const [requestResetLoading, setRequestResetLoading] = React.useState(false);
  const [confirmResetLoading, setConfirmResetLoading] = React.useState(false);
  const navigate = useNavigate();
  const { push } = useToast();

  React.useEffect(() => {
    if (localStorage.getItem("token") || sessionStorage.getItem("token")) {
      navigate("/sessions");
    }
  }, [navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await login(username, password, rememberMe);
      const payload = parseJwt(response.access_token);
      if (!payload?.sub) {
        throw new Error("登录凭证无效");
      }
      storeAuthData(response.access_token, String(payload.sub), rememberMe);
      if (response.force_password_change) {
        navigate("/force-password");
      } else {
        navigate("/sessions");
      }
    } catch (error) {
      push(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenResetDialog = async () => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      push("请输入用户名后再重置密码");
      return;
    }

    setRequestResetLoading(true);
    try {
      const response = await requestPasswordReset(trimmedUsername);
      setResetUsername(trimmedUsername);
      setVerificationCode("");
      setResetExpiresInSeconds(response.expires_in_seconds);
      setResetDialogOpen(true);
      push("校验码已输出到后台日志，请输入校验码");
    } catch (error) {
      push(error instanceof Error ? error.message : "发送重置校验码失败");
    } finally {
      setRequestResetLoading(false);
    }
  };

  const handleResendVerificationCode = async () => {
    if (!resetUsername) {
      return;
    }
    setRequestResetLoading(true);
    try {
      const response = await requestPasswordReset(resetUsername);
      setVerificationCode("");
      setResetExpiresInSeconds(response.expires_in_seconds);
      push("新的校验码已输出到后台日志");
    } catch (error) {
      push(error instanceof Error ? error.message : "发送重置校验码失败");
    } finally {
      setRequestResetLoading(false);
    }
  };

  const handleConfirmPasswordReset = async () => {
    if (!resetUsername || !verificationCode.trim()) {
      push("请输入校验码");
      return;
    }
    setConfirmResetLoading(true);
    try {
      await confirmPasswordReset(resetUsername, verificationCode.trim());
      setResetDialogOpen(false);
      setVerificationCode("");
      setPassword("");
      push("校验成功，随机密码已重置，请查看后台输出的新密码");
    } catch (error) {
      push(error instanceof Error ? error.message : "重置密码失败");
    } finally {
      setConfirmResetLoading(false);
    }
  };

  const closeResetDialog = () => {
    if (requestResetLoading || confirmResetLoading) {
      return;
    }
    setResetDialogOpen(false);
    setVerificationCode("");
  };

  const isDisabled = !username || !password || loading;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <Card title="WebSSH 登录" description="初始密码会在后台输出">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">用户名</label>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">密码</label>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            记住我
          </label>
          <div className="flex gap-3">
            <Button disabled={isDisabled} type="submit" className="w-full">
              {loading ? "登录中..." : "登录"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="whitespace-nowrap"
              loading={requestResetLoading}
              onClick={handleOpenResetDialog}
            >
              重置密码
            </Button>
          </div>
        </form>
      </Card>

      {resetDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeResetDialog} />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-100">重置密码</h2>
            <p className="mt-2 text-sm text-slate-400">
              后端已为账号 <span className="font-medium text-slate-200">{resetUsername}</span> 输出一次性校验码。
              {resetExpiresInSeconds ? ` 校验码 ${Math.round(resetExpiresInSeconds / 60)} 分钟内有效。` : ""}
            </p>
            <p className="text-sm text-slate-500">校验成功后，系统会在后端输出新的随机密码，并要求下次登录修改密码。</p>
            <div className="mt-4 space-y-2">
              <label className="text-sm text-slate-400">校验码</label>
              <Input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="请输入后台输出的校验码"
              />
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={closeResetDialog}
                disabled={requestResetLoading || confirmResetLoading}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={requestResetLoading}
                onClick={handleResendVerificationCode}
                disabled={confirmResetLoading}
              >
                重新获取校验码
              </Button>
              <Button
                type="button"
                loading={confirmResetLoading}
                onClick={handleConfirmPasswordReset}
                disabled={!verificationCode.trim() || requestResetLoading}
              >
                校验并重置
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
