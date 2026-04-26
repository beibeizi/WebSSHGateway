import React from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { useToast } from "../components/Toast";
import { useApp } from "../context/AppContext";
import { getSystemLogs, type SystemLogEntry } from "../lib/api";

const LEVELS = ["ALL", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] as const;
const LIMITS = [100, 200, 500, 1000] as const;

function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

function getLevelClassName(level: string, isDark: boolean): string {
  if (level === "ERROR" || level === "CRITICAL") {
    return isDark ? "bg-rose-500/15 text-rose-300 border-rose-500/30" : "bg-rose-50 text-rose-700 border-rose-200";
  }
  if (level === "WARNING") {
    return isDark ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (level === "DEBUG") {
    return isDark ? "bg-slate-700 text-slate-300 border-slate-600" : "bg-slate-100 text-slate-600 border-slate-200";
  }
  return isDark ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-emerald-50 text-emerald-700 border-emerald-200";
}

export function SystemLogsPage() {
  const { isDark, toggleTheme, toggleLanguage, language } = useApp();
  const { push } = useToast();
  const t = React.useCallback((zh: string, en: string) => localizeText(language, zh, en), [language]);
  const [entries, setEntries] = React.useState<SystemLogEntry[]>([]);
  const [level, setLevel] = React.useState<(typeof LEVELS)[number]>("ALL");
  const [limit, setLimit] = React.useState(200);
  const [loading, setLoading] = React.useState(false);

  const loadLogs = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSystemLogs({
        limit,
        level: level === "ALL" ? null : level,
      });
      setEntries(result.entries);
    } catch (error) {
      push(error instanceof Error ? error.message : t("获取系统日志失败", "Failed to get system logs"));
    } finally {
      setLoading(false);
    }
  }, [level, limit, push, t]);

  React.useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const panelClassName = isDark ? "border-slate-700 bg-slate-950/40" : "border-slate-200 bg-white";
  const subtleClassName = isDark ? "text-slate-400" : "text-slate-500";
  const inputClassName = isDark
    ? "border-slate-700 bg-slate-900 text-slate-100"
    : "border-slate-300 bg-white text-slate-900";

  return (
    <div className={`min-h-screen px-4 py-6 transition-colors duration-300 ${isDark ? "bg-slate-950 text-slate-100 dark-scrollbar" : "bg-gray-100 text-slate-900 light-scrollbar"}`}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className={`flex flex-wrap items-start justify-between gap-3 pb-4 ${isDark ? "border-b border-slate-800" : "border-b border-slate-200"}`}>
          <div>
            <h1 className="text-2xl font-semibold">{t("系统日志", "System Logs")}</h1>
            <p className={`mt-1 text-sm ${subtleClassName}`}>
              {t("查看后端最近运行日志，用于定位登录、会话和系统接口问题。", "Inspect recent backend runtime logs for login, session, and system API diagnostics.")}
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
          title={t("最近日志", "Recent Logs")}
          description={t("日志保存在当前进程内存中，服务重启后会重新开始记录。", "Logs are kept in current process memory and reset after service restart.")}
          className={!isDark ? "bg-white border-slate-200 shadow-sm" : ""}
          titleClassName={!isDark ? "text-slate-900" : ""}
          descClassName={!isDark ? "text-slate-500" : ""}
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className={`block text-xs ${subtleClassName}`}>{t("级别", "Level")}</span>
              <select
                value={level}
                onChange={(event) => setLevel(event.target.value as (typeof LEVELS)[number])}
                className={`h-10 rounded-md border px-3 text-sm ${inputClassName}`}
              >
                {LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {item === "ALL" ? t("全部", "All") : item}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={`block text-xs ${subtleClassName}`}>{t("数量", "Limit")}</span>
              <select
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                className={`h-10 rounded-md border px-3 text-sm ${inputClassName}`}
              >
                {LIMITS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" lightMode={!isDark} loading={loading} onClick={() => void loadLogs()}>
              <RefreshCcw className="h-4 w-4" />
              {t("刷新", "Refresh")}
            </Button>
          </div>

          <div className={`mt-4 overflow-hidden rounded-lg border ${panelClassName}`}>
            <div className="max-h-[68vh] overflow-auto">
              {entries.length === 0 ? (
                <div className={`p-4 text-sm ${subtleClassName}`}>
                  {loading ? t("加载日志中...", "Loading logs...") : t("暂无日志", "No logs")}
                </div>
              ) : (
                <div className="divide-y divide-slate-700/40">
                  {entries.map((entry) => (
                    <div key={entry.sequence} className={`grid gap-2 p-3 text-xs md:grid-cols-[170px,92px,1fr] ${isDark ? "hover:bg-slate-900/70" : "hover:bg-slate-50"}`}>
                      <div className={subtleClassName}>{entry.timestamp}</div>
                      <div>
                        <span className={`inline-flex rounded border px-2 py-0.5 font-mono text-[11px] ${getLevelClassName(entry.level, isDark)}`}>
                          {entry.level}
                        </span>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className={`flex flex-wrap gap-2 font-mono ${subtleClassName}`}>
                          <span>{entry.logger}</span>
                          <span>rid:{entry.request_id}</span>
                        </div>
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{entry.line}</pre>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
