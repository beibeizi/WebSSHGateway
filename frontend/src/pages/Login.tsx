import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { useToast } from "../components/Toast";
import { login, storeAuthData } from "../lib/api";
import { parseJwt } from "../lib/auth";

export function Login() {
  const [username, setUsername] = React.useState("admin");
  const [password, setPassword] = React.useState("");
  const [rememberMe, setRememberMe] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false);
  const [resetUsername, setResetUsername] = React.useState("");
  const navigate = useNavigate();
  const { push } = useToast();
  const resetCommand = `cd backend && python -m app.cli reset-password --username ${resetUsername || "<用户名>"}`;

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

  const handleOpenResetDialog = () => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      push("请输入用户名后再重置密码");
      return;
    }
    setResetUsername(trimmedUsername);
    setResetDialogOpen(true);
  };

  const closeResetDialog = () => {
    setResetDialogOpen(false);
  };

  const isDisabled = !username || !password || loading;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <Card title="WebSSH 登录" description="首次部署请在 .env 中设置 INITIAL_ADMIN_PASSWORD">
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
              Web 端不支持自助重置密码。请联系管理员在服务器上为账号{" "}
              <span className="font-medium text-slate-200">{resetUsername}</span> 执行以下命令：
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-200">
              <code>{resetCommand}</code>
            </pre>
            <p className="mt-3 text-sm text-slate-500">
              命令执行后会要求输入新密码，并在下次登录时强制修改密码。如需自动化，可附加{" "}
              <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">--password-stdin</code>。
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={closeResetDialog}>
                我知道了
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
