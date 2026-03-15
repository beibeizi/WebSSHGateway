import React from "react";
import { getSystemOverview, readFile, writeFile, SystemStats, NetworkInfo, ProcessInfo, DiskInfo } from "../lib/api";
import { useApp } from "../context/AppContext";
import type { NetworkProfile } from "../context/AppContext";
import { useToast } from "./Toast";

function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

type SortField = "cpu" | "memory";
type SortOrder = "asc" | "desc";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

type ProgressBarProps = {
  percent: number;
  isDark: boolean;
  color?: "blue" | "green" | "yellow" | "red" | "cyan" | "purple";
};

function ProgressBar({ percent, isDark, color = "blue" }: ProgressBarProps) {
  const colorClasses = {
    blue: "bg-blue-500",
    green: "bg-emerald-500",
    yellow: "bg-amber-500",
    red: "bg-rose-500",
    cyan: "bg-cyan-500",
    purple: "bg-purple-500",
  };

  const getColor = () => {
    if (percent >= 90) return colorClasses.red;
    if (percent >= 70) return colorClasses.yellow;
    if (percent >= 50) return colorClasses.green;
    return colorClasses[color];
  };

  return (
    <div className={`h-2 w-full rounded-full ${isDark ? "bg-slate-700" : "bg-slate-200"}`}>
      <div
        className={`h-2 rounded-full transition-all duration-300 ${getColor()}`}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

type SystemMonitorProps = {
  sessionId: string;
  isDark: boolean;
  selectedFilePath?: string;
  networkProfile?: NetworkProfile;
  compact?: boolean;
};

export function SystemMonitor({ sessionId, isDark, selectedFilePath, networkProfile, compact }: SystemMonitorProps) {
  const { networkProfile: globalNetworkProfile, language } = useApp();
  const t = React.useCallback((zh: string, en: string) => localizeText(language, zh, en), [language]);
  const effectiveNetworkProfile = networkProfile ?? globalNetworkProfile;
  const isCompact = compact === true;
  const [stats, setStats] = React.useState<SystemStats | null>(null);
  const [network, setNetwork] = React.useState<NetworkInfo | null>(null);
  const [processes, setProcesses] = React.useState<ProcessInfo[]>([]);
  const [disks, setDisks] = React.useState<DiskInfo[]>([]);
  const [fileContent, setFileContent] = React.useState<string>("");
  const [originalContent, setOriginalContent] = React.useState<string>("");
  const [fileLoading, setFileLoading] = React.useState(false);
  const [fileTooLarge, setFileTooLarge] = React.useState(false);
  const [fileSize, setFileSize] = React.useState(0);
  const [sortField, setSortField] = React.useState<SortField>("memory");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("desc");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { push } = useToast();
  const overviewInFlightRef = React.useRef(false);
  const metricsPollIntervalMs =
    effectiveNetworkProfile === "poor" ? 12000 : effectiveNetworkProfile === "degraded" ? 7000 : 3000;

  // 获取系统概览（CPU、内存、网络、进程、磁盘）
  const fetchOverview = React.useCallback(async () => {
    if (overviewInFlightRef.current) return;
    overviewInFlightRef.current = true;
    try {
      const overview = await getSystemOverview(sessionId);
      setStats(overview.stats);
      setNetwork(overview.network);
      setProcesses(overview.processes.processes);
      setDisks(overview.disks.disks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("获取数据失败", "Failed to fetch system data"));
    } finally {
      overviewInFlightRef.current = false;
      setLoading(false);
    }
  }, [sessionId, t]);

  // 读取文件内容
  React.useEffect(() => {
    if (!selectedFilePath) {
      setFileContent("");
      setOriginalContent("");
      setFileTooLarge(false);
      return;
    }

    const loadFile = async (force = false) => {
      setFileLoading(true);
      try {
        const result = await readFile(sessionId, selectedFilePath, force);
        if (result.too_large) {
          setFileTooLarge(true);
          setFileSize(result.size);
          setFileContent("");
          setOriginalContent("");
        } else {
          setFileContent(result.content || "");
          setOriginalContent(result.content || "");
          setFileTooLarge(false);
        }
      } catch (err) {
        push(err instanceof Error ? err.message : t("读取文件失败", "Failed to read file"));
        setFileContent("");
        setOriginalContent("");
      } finally {
        setFileLoading(false);
      }
    };

    loadFile();
  }, [sessionId, selectedFilePath, push, t]);

  const handleLoadLargeFile = React.useCallback(async () => {
    if (!selectedFilePath) return;
    setFileLoading(true);
    try {
      const result = await readFile(sessionId, selectedFilePath, true);
      setFileContent(result.content || "");
      setOriginalContent(result.content || "");
      setFileTooLarge(false);
    } catch (err) {
      push(err instanceof Error ? err.message : t("读取文件失败", "Failed to read file"));
    } finally {
      setFileLoading(false);
    }
  }, [sessionId, selectedFilePath, push, t]);

  // 保存文件
  const handleSaveFile = React.useCallback(async () => {
    if (!selectedFilePath) return;
    try {
      await writeFile(sessionId, selectedFilePath, fileContent);
      setOriginalContent(fileContent);
      push(t("保存成功", "Saved successfully"));
    } catch (err) {
      push(err instanceof Error ? err.message : t("保存失败", "Save failed"));
    }
  }, [sessionId, selectedFilePath, fileContent, push, t]);

  // 系统监控轮询：改为单接口拉取并按网络质量动态降频
  React.useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      timer = window.setTimeout(run, metricsPollIntervalMs);
    };

    const run = async () => {
      await fetchOverview();
      scheduleNext();
    };

    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [fetchOverview, metricsPollIntervalMs]);

  // 排序处理
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const sortedProcesses = React.useMemo(() => {
    const sorted = [...processes].sort((a, b) => {
      const aVal = sortField === "cpu" ? a.cpu_percent : a.memory_percent;
      const bVal = sortField === "cpu" ? b.cpu_percent : b.memory_percent;
      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });
    return sorted.slice(0, 5);
  }, [processes, sortField, sortOrder]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="opacity-30">↕</span>;
    return <span>{sortOrder === "desc" ? "↓" : "↑"}</span>;
  };

  if (loading) {
    return (
        <div className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
        {t("加载中...", "Loading...")}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-xs ${isDark ? "text-rose-400" : "text-rose-500"}`}>
        {error}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className={isCompact ? "space-y-3" : "space-y-4"}>
      <div>
        <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-slate-200" : "text-slate-700"}`}>
          {t("系统状态", "System Status")}
        </h3>

        {/* CPU */}
        <div className="mb-3">
          <div className="flex justify-between items-center mb-1">
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t(`CPU (${stats.cpu.count} 核)`, `CPU (${stats.cpu.count} Cores)`)}
            </span>
            <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-slate-600"}`}>
              {stats.cpu.percent.toFixed(1)}%
            </span>
          </div>
          <ProgressBar percent={stats.cpu.percent} isDark={isDark} color="blue" />
        </div>

        {/* 内存 */}
        <div className="mb-3">
          <div className="flex justify-between items-center mb-1">
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("内存", "Memory")}
            </span>
            <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-slate-600"}`}>
              {stats.memory.percent.toFixed(1)}% ({formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)})
            </span>
          </div>
          <ProgressBar percent={stats.memory.percent} isDark={isDark} color="green" />
        </div>

        {/* 交换区 */}
        <div className="mb-3">
          <div className="flex justify-between items-center mb-1">
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("交换区", "Swap")}
            </span>
            <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-slate-600"}`}>
              {stats.swap.total > 0
                ? `${stats.swap.percent.toFixed(1)}% (${formatBytes(stats.swap.used)} / ${formatBytes(stats.swap.total)})`
                : t("未启用", "Disabled")
              }
            </span>
          </div>
          {stats.swap.total > 0 && (
            <ProgressBar percent={stats.swap.percent} isDark={isDark} color="yellow" />
          )}
        </div>

        {/* 网络速度 */}
        <div className={`pt-3 mt-3 ${isDark ? "border-t border-slate-700" : "border-t border-slate-200"}`}>
          <div className="flex justify-between items-center">
            <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {t("网络", "Network")}
            </span>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium ${isDark ? "text-purple-400" : "text-purple-600"}`}>
                ↑ {network ? formatSpeed(network.upload_speed) : "-"}
              </span>
              <span className={`text-xs font-medium ${isDark ? "text-cyan-400" : "text-cyan-600"}`}>
                ↓ {network ? formatSpeed(network.download_speed) : "-"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 进程列表 */}
      <div className={`pt-4 ${isDark ? "border-t border-slate-700" : "border-t border-slate-200"}`}>
        <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-slate-200" : "text-slate-700"}`}>
          {t("进程 TOP 5", "Top 5 Processes")}
        </h3>

        {/* 表头 */}
        <div className={`flex text-xs mb-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          <div className="flex-1">{t("进程名", "Process")}</div>
          <div
            className="w-16 text-right cursor-pointer hover:text-indigo-400 select-none"
            onClick={() => handleSort("cpu")}
          >
            CPU <SortIcon field="cpu" />
          </div>
          <div
            className="w-20 text-right cursor-pointer hover:text-indigo-400 select-none"
            onClick={() => handleSort("memory")}
          >
            {t("内存", "Memory")} <SortIcon field="memory" />
          </div>
        </div>

        {/* 进程表 */}
        <div className="space-y-1">
          {sortedProcesses.map((proc) => (
            <div
              key={proc.pid}
              className={`flex text-xs py-1 rounded px-1 ${isDark ? "hover:bg-slate-800" : "hover:bg-slate-100"} group relative`}
              title={proc.command}
            >
              <div className={`flex-1 truncate ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                {proc.name}
              </div>
              <div className={`w-16 text-right ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                {proc.cpu_percent.toFixed(1)}%
              </div>
              <div className={`w-20 text-right ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                {formatBytes(proc.memory_bytes)}
              </div>
            </div>
          ))}
          {sortedProcesses.length === 0 && (
            <div className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
              {t("暂无数据", "No data")}
            </div>
          )}
        </div>
      </div>

      {/* 磁盘信息 */}
      <div className={`pt-4 ${isDark ? "border-t border-slate-700" : "border-t border-slate-200"}`}>
        <h3 className={`text-sm font-semibold mb-3 ${isDark ? "text-slate-200" : "text-slate-700"}`}>
          {t("磁盘挂载", "Disk Mounts")}
        </h3>
        <div className="space-y-2">
          {disks.map((disk) => (
            <div key={disk.mount}>
              <div className="flex justify-between items-center mb-1">
                <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  {disk.mount}
                </span>
                <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                  {disk.percent.toFixed(1)}% ({formatBytes(disk.used)} / {formatBytes(disk.total)})
                </span>
              </div>
              <ProgressBar percent={disk.percent} isDark={isDark} color="cyan" />
            </div>
          ))}
        </div>
      </div>

      {/* 文件预览 */}
      {selectedFilePath && (
        <div className={`pt-4 ${isDark ? "border-t border-slate-700" : "border-t border-slate-200"}`}>
          <div className="flex justify-between items-center mb-2">
            <h3 className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-700"}`}>
              {t("文件预览", "File Preview")}
            </h3>
            <button
              onClick={handleSaveFile}
              disabled={fileContent === originalContent || fileTooLarge}
              className={`${isCompact ? "px-3 py-2 text-sm" : "px-2 py-1 text-xs"} rounded ${
                fileContent === originalContent || fileTooLarge
                  ? "opacity-50 cursor-not-allowed"
                  : (isDark ? "bg-indigo-600 hover:bg-indigo-500" : "bg-indigo-500 hover:bg-indigo-400")
              } text-white`}
            >
              {t("保存", "Save")}
            </button>
          </div>
          {fileLoading ? (
            <div className={`flex items-center justify-center text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`} style={{ height: "172px" }}>
              <span className="animate-spin mr-2">⟳</span> {t("加载中...", "Loading...")}
            </div>
          ) : fileTooLarge ? (
            <div className={`flex flex-col items-center justify-center text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`} style={{ height: "172px" }}>
              <p className="mb-2">{t(`文件过大 (${(fileSize / 1024 / 1024).toFixed(2)} MB)`, `File too large (${(fileSize / 1024 / 1024).toFixed(2)} MB)`)}</p>
              <button
                onClick={handleLoadLargeFile}
                className={`px-3 py-1 rounded ${isDark ? "bg-indigo-600 hover:bg-indigo-500" : "bg-indigo-500 hover:bg-indigo-400"} text-white`}
              >
                {t("仍然加载", "Load anyway")}
              </button>
            </div>
          ) : (
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className={`w-full text-xs font-mono p-2 rounded border ${
                isDark
                  ? "bg-slate-900 border-slate-700 text-slate-200"
                  : "bg-white border-slate-300 text-slate-700"
              }`}
              style={{ height: "172px" }}
            />
          )}
        </div>
      )}
    </div>
  );
}
