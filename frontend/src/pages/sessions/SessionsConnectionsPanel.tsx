import React from "react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Input } from "../../components/Input";
import type { SessionsState } from "./useSessionsState";

type SessionsConnectionsPanelProps = {
  state: SessionsState;
};

export function SessionsConnectionsPanel({ state }: SessionsConnectionsPanelProps) {
  return (
    <Card
      title={state.t("新增 SSH 连接", "New SSH Connection")}
      description={state.t("保存连接信息并发起会话", "Save connection details and start sessions")}
      className={!state.isDark ? "bg-white border-slate-200 shadow-sm" : ""}
      titleClassName={!state.isDark ? "text-slate-900" : ""}
      descClassName={!state.isDark ? "text-slate-500" : ""}
    >
      <div className="space-y-4">
        <Button
          variant={state.showCreateForm ? "secondary" : "primary"}
          lightMode={!state.isDark}
          onClick={() => state.setShowCreateForm((prev) => !prev)}
          className="w-full"
        >
          {state.showCreateForm ? state.t("收起表单", "Hide form") : state.t("新增连接", "New connection")}
        </Button>
        {state.showCreateForm ? (
          <form className="space-y-4" onSubmit={state.handleCreateConnection}>
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                state.isDark
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {state.t(
                "请确保该项目所运行的机器可以访问到目标连接。",
                "Make sure the machine running this project can reach the target connection."
              )}
            </div>
            <Input
              placeholder={state.t("连接名称", "Connection name")}
              value={state.form.name}
              onChange={(event) => state.setForm({ ...state.form, name: event.target.value })}
              className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
            />
            <Input
              placeholder={state.t("主机 IP", "Host IP")}
              value={state.form.host}
              onChange={(event) => state.setForm({ ...state.form, host: event.target.value })}
              className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
            />
            <Input
              placeholder={state.t("端口", "Port")}
              type="number"
              value={state.form.port}
              onChange={(event) => state.setForm({ ...state.form, port: Number(event.target.value) })}
              className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
            />
            <Input
              placeholder={state.t("用户名", "Username")}
              value={state.form.username}
              onChange={(event) => state.setForm({ ...state.form, username: event.target.value })}
              className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant={state.form.auth_type === "password" ? "primary" : "secondary"}
                lightMode={!state.isDark}
                onClick={() => state.setForm({ ...state.form, auth_type: "password" })}
              >
                {state.t("密码", "Password")}
              </Button>
              <Button
                type="button"
                variant={state.form.auth_type === "private_key" ? "primary" : "secondary"}
                lightMode={!state.isDark}
                onClick={() => state.setForm({ ...state.form, auth_type: "private_key" })}
              >
                {state.t("私钥", "Private key")}
              </Button>
            </div>
            {state.form.auth_type === "password" ? (
              <Input
                placeholder={state.t("密码", "Password")}
                type="password"
                value={state.form.password}
                onChange={(event) => state.setForm({ ...state.form, password: event.target.value })}
                className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
              />
            ) : (
              <>
                <textarea
                  className={`min-h-[120px] w-full rounded-md border px-3 py-2 text-sm ${state.isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
                  placeholder={state.t("私钥内容", "Private key content")}
                  value={state.form.private_key}
                  onChange={(event) => state.setForm({ ...state.form, private_key: event.target.value })}
                />
                <Input
                  placeholder={state.t("私钥密码（可选）", "Private key passphrase (optional)")}
                  type="password"
                  value={state.form.key_passphrase}
                  onChange={(event) => state.setForm({ ...state.form, key_passphrase: event.target.value })}
                  className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
              </>
            )}
            <Button type="submit" lightMode={!state.isDark} className="w-full">
              {state.t("保存连接", "Save connection")}
            </Button>
          </form>
        ) : null}
      </div>
      <div className={`mt-6 pt-6 space-y-3 ${state.isDark ? "border-t border-slate-700" : "border-t border-slate-200"}`}>
        <p className={`text-sm font-semibold ${state.isDark ? "text-slate-200" : "text-slate-700"}`}>{state.t("已保存连接", "Saved connections")}</p>
        {state.connections.map((conn) => (
          <div key={conn.id} className={`rounded-md border p-3 text-sm ${state.isDark ? "border-slate-700 bg-slate-900/60 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
            {state.editingConnection?.id === conn.id ? (
              <form className="space-y-3" onSubmit={state.handleUpdateConnection}>
                <Input
                  placeholder={state.t("连接名称", "Connection name")}
                  value={state.editForm.name}
                  onChange={(event) => state.setEditForm({ ...state.editForm, name: event.target.value })}
                  className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
                <Input
                  placeholder={state.t("主机 IP", "Host IP")}
                  value={state.editForm.host}
                  onChange={(event) => state.setEditForm({ ...state.editForm, host: event.target.value })}
                  className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
                <Input
                  placeholder={state.t("端口", "Port")}
                  type="number"
                  value={state.editForm.port}
                  onChange={(event) => state.setEditForm({ ...state.editForm, port: Number(event.target.value) })}
                  className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
                <Input
                  placeholder={state.t("用户名", "Username")}
                  value={state.editForm.username}
                  onChange={(event) => state.setEditForm({ ...state.editForm, username: event.target.value })}
                  className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={state.editForm.auth_type === "password" ? "primary" : "secondary"}
                    lightMode={!state.isDark}
                    onClick={() => state.setEditForm({ ...state.editForm, auth_type: "password" })}
                  >
                    {state.t("密码", "Password")}
                  </Button>
                  <Button
                    type="button"
                    variant={state.editForm.auth_type === "private_key" ? "primary" : "secondary"}
                    lightMode={!state.isDark}
                    onClick={() => state.setEditForm({ ...state.editForm, auth_type: "private_key" })}
                  >
                    {state.t("私钥", "Private key")}
                  </Button>
                </div>
                <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>{state.t("留空则保持原凭据不变", "Leave empty to keep original credentials")}</p>
                {state.editForm.auth_type === "password" ? (
                  <Input
                    placeholder={state.t("新密码（可选）", "New password (optional)")}
                    type="password"
                    value={state.editForm.password}
                    onChange={(event) => state.setEditForm({ ...state.editForm, password: event.target.value })}
                    className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                  />
                ) : (
                  <>
                    <textarea
                      className={`min-h-[80px] w-full rounded-md border px-3 py-2 text-sm ${state.isDark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"}`}
                      placeholder={state.t("新私钥（可选）", "New private key (optional)")}
                      value={state.editForm.private_key}
                      onChange={(event) => state.setEditForm({ ...state.editForm, private_key: event.target.value })}
                    />
                    <Input
                      placeholder={state.t("私钥密码（可选）", "Private key passphrase (optional)")}
                      type="password"
                      value={state.editForm.key_passphrase}
                      onChange={(event) => state.setEditForm({ ...state.editForm, key_passphrase: event.target.value })}
                      className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                    />
                  </>
                )}
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" lightMode={!state.isDark}>
                    {state.t("保存", "Save")}
                  </Button>
                  <Button type="button" variant="ghost" lightMode={!state.isDark} onClick={() => state.setEditingConnection(null)}>
                    {state.t("取消", "Cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className={`text-base font-semibold ${state.isDark ? "text-slate-100" : "text-slate-800"}`}>{conn.name}</p>
                  <p className={`text-xs ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
                    {conn.username}@{conn.host}:{conn.port}
                  </p>
                  <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
                    {state.t("创建", "Created")}: {new Date(conn.created_at).toLocaleString()} | {state.t("更新", "Updated")}: {new Date(conn.updated_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    lightMode={!state.isDark}
                    loading={state.connectingId === conn.id}
                    disabled={state.connectingId !== null}
                    onClick={() => state.handleCreateSession(conn.id)}
                  >
                    {state.t("创建新的连接", "Create new connection")}
                  </Button>
                  <Button variant="ghost" lightMode={!state.isDark} onClick={() => state.handleEditConnection(conn)}>
                    {state.t("编辑", "Edit")}
                  </Button>
                  <Button variant="ghost" lightMode={!state.isDark} onClick={() => state.setDeleteConfirm({ type: "connection", id: conn.id, name: conn.name })}>
                    {state.t("删除", "Delete")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
