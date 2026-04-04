import React from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Input } from "../components/Input";
import { useToast } from "../components/Toast";
import { useApp } from "../context/AppContext";
import { updateSystemSettings } from "../lib/api";

function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

function parseRetrySchedule(text: string): number[] {
  return text
    .split(/[,\uff0c]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));
}

export function SystemSettingsPage() {
  const {
    isDark,
    toggleTheme,
    toggleLanguage,
    language,
    systemSettings,
    systemSettingsLoading,
    applySystemSettings,
  } = useApp();
  const { push } = useToast();
  const t = React.useCallback((zh: string, en: string) => localizeText(language, zh, en), [language]);
  const [form, setForm] = React.useState({
    enhancedRetryMaxAttempts: "5",
    enhancedRetrySchedule: "2,4,8,16,32",
    sessionStatusRefreshIntervalSeconds: "3",
    defaultEnableEnhancedSession: false,
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!systemSettings) {
      return;
    }
    setForm({
      enhancedRetryMaxAttempts: String(systemSettings.enhanced_retry_max_attempts),
      enhancedRetrySchedule: systemSettings.enhanced_retry_schedule_seconds.join(","),
      sessionStatusRefreshIntervalSeconds: String(systemSettings.session_status_refresh_interval_seconds),
      defaultEnableEnhancedSession: systemSettings.default_enable_enhanced_session,
    });
  }, [systemSettings]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();

    const enhancedRetryMaxAttempts = Number(form.enhancedRetryMaxAttempts);
    const sessionStatusRefreshIntervalSeconds = Number(form.sessionStatusRefreshIntervalSeconds);
    const enhancedRetryScheduleSeconds = parseRetrySchedule(form.enhancedRetrySchedule);

    if (!Number.isInteger(enhancedRetryMaxAttempts) || enhancedRetryMaxAttempts < 1) {
      push(t("增强会话自动重试次数必须是大于 0 的整数", "Enhanced retry attempts must be a positive integer."));
      return;
    }
    if (!Number.isInteger(sessionStatusRefreshIntervalSeconds) || sessionStatusRefreshIntervalSeconds < 1) {
      push(t("系统状态刷新间隔必须是大于 0 的整数秒", "System status refresh interval must be a positive integer."));
      return;
    }
    if (enhancedRetryScheduleSeconds.length === 0 || enhancedRetryScheduleSeconds.some((value) => !Number.isInteger(value) || value < 1)) {
      push(t("增强会话自动重试间隔必须是逗号分隔的正整数秒", "Retry schedule must be comma-separated positive integers."));
      return;
    }

    setSaving(true);
    try {
      const saved = await updateSystemSettings({
        enhanced_retry_max_attempts: enhancedRetryMaxAttempts,
        enhanced_retry_schedule_seconds: enhancedRetryScheduleSeconds,
        session_status_refresh_interval_seconds: sessionStatusRefreshIntervalSeconds,
        default_enable_enhanced_session: form.defaultEnableEnhancedSession,
      });
      applySystemSettings(saved);
      push(t("系统设置已保存并应用", "System settings saved and applied."));
    } catch (error) {
      push(error instanceof Error ? error.message : t("保存系统设置失败", "Failed to save system settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`min-h-screen px-4 py-6 transition-colors duration-300 ${isDark ? "bg-slate-950 text-slate-100 dark-scrollbar" : "bg-gray-100 text-slate-900 light-scrollbar"}`}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className={`flex flex-wrap items-start justify-between gap-3 pb-4 ${isDark ? "border-b border-slate-800" : "border-b border-slate-200"}`}>
          <div>
            <h1 className="text-2xl font-semibold">{t("系统设置", "System Settings")}</h1>
            <p className={`mt-1 text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("保存后立即应用到后续自动重试、新建会话和会话页状态轮询。", "Saved settings apply immediately to retries, new sessions, and session status polling.")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" lightMode={!isDark} onClick={toggleLanguage}>
              {language === "en-US" ? "中文" : "EN"}
            </Button>
            <Button variant="ghost" lightMode={!isDark} onClick={toggleTheme}>
              {isDark ? t("浅色", "Light") : t("深色", "Dark")}
            </Button>
            <Button
              variant="secondary"
              lightMode={!isDark}
              onClick={() => {
                window.location.href = "/sessions";
              }}
            >
              {t("返回会话管理", "Back to Sessions")}
            </Button>
          </div>
        </div>

        <Card
          title={t("全局运行设置", "Global Runtime Settings")}
          description={t("这里只包含当前已支持页面化管理且可即时生效的系统级参数。", "This page only includes system-wide settings that are currently supported for immediate runtime updates.")}
          className={!isDark ? "bg-white border-slate-200 shadow-sm" : ""}
          titleClassName={!isDark ? "text-slate-900" : ""}
          descClassName={!isDark ? "text-slate-500" : ""}
        >
          {systemSettingsLoading && !systemSettings ? (
            <div className={`text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>{t("加载系统设置中...", "Loading system settings...")}</div>
          ) : (
            <form className="space-y-5" onSubmit={handleSave}>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("增强会话自动重试最大次数", "Enhanced Retry Max Attempts")}</label>
                <Input
                  type="number"
                  min={1}
                  value={form.enhancedRetryMaxAttempts}
                  onChange={(event) => setForm((prev) => ({ ...prev, enhancedRetryMaxAttempts: event.target.value }))}
                  className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                  {t("控制增强持久化会话自动重连的最大尝试次数。", "Controls the maximum retry attempts for enhanced persistent sessions.")}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("增强会话自动重试间隔（秒）", "Enhanced Retry Schedule (seconds)")}</label>
                <Input
                  value={form.enhancedRetrySchedule}
                  onChange={(event) => setForm((prev) => ({ ...prev, enhancedRetrySchedule: event.target.value }))}
                  placeholder="2,4,8,16,32"
                  className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                  {t("按顺序填写每次重试前的等待秒数，使用英文逗号分隔；当次数超过列表长度时会继续使用最后一个间隔。", "Enter comma-separated delays before each retry. If attempts exceed the list length, the last delay keeps being used.")}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("会话系统状态刷新间隔（秒）", "Session Status Refresh Interval (seconds)")}</label>
                <Input
                  type="number"
                  min={1}
                  value={form.sessionStatusRefreshIntervalSeconds}
                  onChange={(event) => setForm((prev) => ({ ...prev, sessionStatusRefreshIntervalSeconds: event.target.value }))}
                  className={!isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
                />
                <p className={`text-xs ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                  {t("会话管理页中系统状态卡片的全局轮询频率。", "Global polling interval for session status cards on the session management page.")}
                </p>
              </div>

              <div className={`rounded-lg border p-4 ${isDark ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-slate-50"}`}>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={form.defaultEnableEnhancedSession}
                    onChange={(event) => setForm((prev) => ({ ...prev, defaultEnableEnhancedSession: event.target.checked }))}
                    className="mt-1"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium">{t("系统支持时默认开启增强持久化连接", "Enable enhanced persistence by default when supported")}</span>
                    <span className={`block text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                      {t("开启后，用户创建新会话时如果目标系统支持增强持久化连接，将直接按增强模式创建，不再弹出询问框。", "When enabled, supported targets will create new sessions directly in enhanced mode without showing the confirmation dialog.")}
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  lightMode={!isDark}
                  onClick={() => {
                    window.location.href = "/sessions";
                  }}
                  disabled={saving}
                >
                  {t("返回", "Back")}
                </Button>
                <Button type="submit" lightMode={!isDark} loading={saving}>
                  {t("保存并应用", "Save and Apply")}
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
