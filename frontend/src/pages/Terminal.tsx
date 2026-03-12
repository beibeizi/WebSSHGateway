import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { FileBrowser } from "../components/FileBrowser";
import { SystemMonitor } from "../components/SystemMonitor";
import { useToast } from "../components/Toast";
import { useApp } from "../context/AppContext";
import type { NetworkProfile } from "../context/AppContext";
import { clearAuthStorage, getStoredToken, openTerminalSocket, getSession, Session } from "../lib/api";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

type TargetNetworkProfile = "good" | "degraded" | "poor" | "unknown";
const NETWORK_PROFILE_RANK: Record<NetworkProfile, number> = {
  good: 0,
  degraded: 1,
  poor: 2,
};

function pickWorseProfile(a: NetworkProfile, b: NetworkProfile): NetworkProfile {
  return NETWORK_PROFILE_RANK[a] >= NETWORK_PROFILE_RANK[b] ? a : b;
}

function normalizeTargetNetworkProfile(raw: string | undefined | null): TargetNetworkProfile {
  if (raw === "good" || raw === "degraded" || raw === "poor") {
    return raw;
  }
  return "unknown";
}

// 终端主题配置 - 移到组件外部避免重复创建
const darkTerminalTheme = {
  background: "#020617",
  foreground: "#e2e8f0",
  cursor: "#e2e8f0",
  cursorAccent: "#020617",
  selectionBackground: "#334155",
  black: "#1e293b",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#f1f5f9",
  brightBlack: "#475569",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde047",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

const lightTerminalTheme = {
  background: "#ffffff",
  foreground: "#1e293b",
  cursor: "#1e293b",
  cursorAccent: "#ffffff",
  selectionBackground: "#bfdbfe",
  black: "#1e293b",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#f1f5f9",
  brightBlack: "#64748b",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
};

const WHEEL_PIXEL_PER_LINE = 40;
const LATENCY_HISTORY_SIZE = 30;
const ALT_SCREEN_SEQUENCE = /\x1b\[\?(?:1049|1047|47)[hl]/g;
const HARD_RESET_SEQUENCE = /\x1bc/g;
const CLEAR_SCROLLBACK_SEQUENCE = /\x1b\[(?:3|2;3)J/g;
const SANITIZE_TARGET_SEQUENCES = [
  "\x1b[?1049h",
  "\x1b[?1049l",
  "\x1b[?1047h",
  "\x1b[?1047l",
  "\x1b[?47h",
  "\x1b[?47l",
  "\x1bc",
  "\x1b[3J",
  "\x1b[2;3J",
];
const SANITIZE_TARGET_MAX_LENGTH = SANITIZE_TARGET_SEQUENCES.reduce(
  (max, sequence) => Math.max(max, sequence.length),
  0
);

function normalizeWheelDeltaToLines(event: WheelEvent, terminalRows: number): number {
  let lineDelta = event.deltaY;
  if (event.deltaMode === 0) {
    lineDelta = lineDelta / WHEEL_PIXEL_PER_LINE;
  } else if (event.deltaMode === 2) {
    lineDelta = lineDelta * Math.max(terminalRows, 1);
  }
  if (!Number.isFinite(lineDelta)) {
    return 0;
  }
  return lineDelta;
}

function normalizeWheelDeltaToPixels(event: WheelEvent, viewportHeight: number): number {
  let pixelDelta = event.deltaY;
  if (event.deltaMode === 1) {
    pixelDelta = pixelDelta * WHEEL_PIXEL_PER_LINE;
  } else if (event.deltaMode === 2) {
    pixelDelta = pixelDelta * Math.max(viewportHeight, 1);
  }
  if (!Number.isFinite(pixelDelta)) {
    return 0;
  }
  return pixelDelta;
}

function stripTerminalControlSequences(data: string): string {
  // 在增强 tmux 会话中屏蔽会重置本地滚动缓冲的控制序列，保证 xterm scrollback 可持续积累。
  return data
    .replace(ALT_SCREEN_SEQUENCE, "")
    .replace(HARD_RESET_SEQUENCE, "")
    .replace(CLEAR_SCROLLBACK_SEQUENCE, "");
}

function splitSanitizePendingSuffix(data: string): { safeOutput: string; pendingSuffix: string } {
  const maxSuffixLength = Math.min(data.length, SANITIZE_TARGET_MAX_LENGTH - 1);
  let pendingSuffix = "";
  for (let length = 1; length <= maxSuffixLength; length += 1) {
    const suffix = data.slice(-length);
    const isSequencePrefix = SANITIZE_TARGET_SEQUENCES.some(
      (sequence) => sequence.length > suffix.length && sequence.startsWith(suffix)
    );
    if (isSequencePrefix) {
      pendingSuffix = suffix;
    }
  }
  if (!pendingSuffix) {
    return { safeOutput: data, pendingSuffix: "" };
  }
  return {
    safeOutput: data.slice(0, -pendingSuffix.length),
    pendingSuffix,
  };
}

function sanitizeTerminalOutputChunk(
  data: string,
  forceNormalBuffer: boolean,
  pendingSuffix: string
): { output: string; pendingSuffix: string } {
  if (!forceNormalBuffer || data.length === 0) {
    return { output: data, pendingSuffix: "" };
  }
  const merged = pendingSuffix + data;
  const split = splitSanitizePendingSuffix(merged);
  return {
    output: stripTerminalControlSequences(split.safeOutput),
    pendingSuffix: split.pendingSuffix,
  };
}

export function TerminalPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const terminalRef = React.useRef<HTMLDivElement | null>(null);
  const terminalInstance = React.useRef<Terminal | null>(null);
  const fitAddon = React.useRef<FitAddon | null>(null);
  const socketRef = React.useRef<WebSocket | null>(null);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const reconnectCountdownIntervalRef = React.useRef<number | null>(null);
  const reconnectAttemptRef = React.useRef(0);
  const { push } = useToast();
  const {
    isDark,
    toggleTheme,
    toggleLanguage,
    language,
    networkProfile: globalNetworkProfile,
    reportNetworkHint,
    clearNetworkHint,
  } = useApp();
  const t = React.useCallback((zh: string, en: string) => localizeText(language, zh, en), [language]);
  const [connectionState, setConnectionState] = React.useState<"connecting" | "open" | "closed">("connecting");
  const [sessionInfo, setSessionInfo] = React.useState<Session | null>(null);
  const [targetLatencyHistory, setTargetLatencyHistory] = React.useState<number[]>([]);
  const [sidebarWidth, setSidebarWidth] = React.useState(() => {
    const saved = localStorage.getItem("terminal-sidebar-width");
    return saved ? Number(saved) : 256;
  });
  const [isDragging, setIsDragging] = React.useState(false);
  const [autoReconnect, setAutoReconnect] = React.useState(true);
  const [reconnectCountdown, setReconnectCountdown] = React.useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [currentDir, setCurrentDir] = React.useState<string>("/");
  const inputBufferRef = React.useRef<string>("");
  const currentDirRef = React.useRef<string>("/");
  const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(null);
  const [sessionDisconnected, setSessionDisconnected] = React.useState<{ disconnected: boolean; time: string } | null>(null);
  const lastResizeStateRef = React.useRef<{ socket: WebSocket; rows: number; cols: number } | null>(null);
  const sessionCheckInFlightRef = React.useRef(false);
  const enhancedSessionRef = React.useRef(false);
  const sessionTargetNetworkProfile = React.useMemo<TargetNetworkProfile>(
    () => normalizeTargetNetworkProfile(sessionInfo?.target_profile),
    [sessionInfo?.target_profile]
  );
  const targetLatencyMs = React.useMemo(() => {
    if (!sessionInfo) return null;
    const avg = sessionInfo.target_avg_rtt_ms ?? null;
    const current = sessionInfo.target_rtt_ms ?? null;
    return avg ?? current;
  }, [sessionInfo]);
  const mergedSessionNetworkProfile = React.useMemo<NetworkProfile>(() => {
    if (sessionTargetNetworkProfile === "unknown") {
      return globalNetworkProfile;
    }
    return pickWorseProfile(globalNetworkProfile, sessionTargetNetworkProfile);
  }, [globalNetworkProfile, sessionTargetNetworkProfile]);
  const sessionNetworkProfile = React.useMemo<NetworkProfile>(() => {
    if (reconnectCountdown !== null || connectionState === "closed") {
      return "poor";
    }
    return mergedSessionNetworkProfile;
  }, [reconnectCountdown, connectionState, mergedSessionNetworkProfile]);
  const sessionCheckIntervalMs =
    sessionNetworkProfile === "poor" ? 12000 : sessionNetworkProfile === "degraded" ? 6000 : 3000;
  const latencyBarHeights = React.useMemo(() => {
    const history = targetLatencyHistory.slice(-LATENCY_HISTORY_SIZE);
    if (history.length === 0) {
      return new Array<number>(LATENCY_HISTORY_SIZE).fill(0);
    }
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = Math.max(max - min, 1);
    const bars = history.map((value) => {
      const ratio = (value - min) / range;
      return Math.round(3 + ratio * 13);
    });
    const padding = new Array<number>(Math.max(0, LATENCY_HISTORY_SIZE - bars.length)).fill(0);
    return [...padding, ...bars].slice(-LATENCY_HISTORY_SIZE);
  }, [targetLatencyHistory]);
  const latencyHistoryMaxMs = React.useMemo(() => {
    const history = targetLatencyHistory.slice(-LATENCY_HISTORY_SIZE);
    if (history.length === 0) {
      return targetLatencyMs;
    }
    return Math.max(...history);
  }, [targetLatencyHistory, targetLatencyMs]);

  // 鍚屾 currentDir 鍒?ref
  React.useEffect(() => {
    currentDirRef.current = currentDir;
  }, [currentDir]);

  React.useEffect(() => {
    setTargetLatencyHistory([]);
  }, [sessionId]);

  React.useEffect(() => {
    enhancedSessionRef.current = sessionInfo?.enhanced_enabled === true;
  }, [sessionInfo?.enhanced_enabled]);

  React.useEffect(() => {
    if (targetLatencyMs === null) {
      return;
    }
    setTargetLatencyHistory((prev) => [...prev.slice(-(LATENCY_HISTORY_SIZE - 1)), targetLatencyMs]);
  }, [targetLatencyMs]);

  // 清理重连定时器
  const clearReconnectTimer = React.useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (reconnectCountdownIntervalRef.current) {
      clearInterval(reconnectCountdownIntervalRef.current);
      reconnectCountdownIntervalRef.current = null;
    }
    setReconnectCountdown(null);
  }, []);

  // 先定义 sendResize，后面会用到
  const sendResize = React.useCallback((term: Terminal, options?: { force?: boolean }) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    const { rows, cols } = term;
    const lastResize = lastResizeStateRef.current;
    if (
      !options?.force &&
      lastResize &&
      lastResize.socket === socket &&
      lastResize.rows === rows &&
      lastResize.cols === cols
    ) {
      return false;
    }
    socket.send(JSON.stringify({ type: "resize", rows, cols }));
    lastResizeStateRef.current = { socket, rows, cols };
    return true;
  }, []);

  const syncTerminalSize = React.useCallback(
    (term: Terminal, options?: { force?: boolean }) => {
      fitAddon.current?.fit();
      sendResize(term, options);
    },
    [sendResize]
  );

  const sendInput = React.useCallback(
    (data: string, notifyOnError: boolean = false) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (notifyOnError) {
          push(t("终端未连接", "Terminal is not connected"));
        }
        return false;
      }
      socket.send(JSON.stringify({ type: "input", data }));
      return true;
    },
    [push, t]
  );

  const connectSocket = React.useCallback(
    (term: Terminal, isReconnect: boolean = false) => {
      if (!sessionId) {
        return;
      }
      const token = getStoredToken();
      if (!token) {
        clearAuthStorage();
        window.location.href = "/";
        return;
      }

      clearReconnectTimer();
      setConnectionState("connecting");

      if (isReconnect) {
        term.write(`\r\n\x1b[33m${t("正在重新连接...", "Reconnecting...")}\x1b[0m\r\n`);
      }

      const socket = openTerminalSocket(sessionId);
      socketRef.current = socket;
      let sanitizePendingSuffix = "";

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) {
          return;
        }
        const sanitized = sanitizeTerminalOutputChunk(
          String(event.data ?? ""),
          enhancedSessionRef.current,
          sanitizePendingSuffix
        );
        sanitizePendingSuffix = sanitized.pendingSuffix;
        const output = sanitized.output;
        term.write(output);

        // 检测目录变化：解析提示符中的路径
        const text = output.replace(/\x1b\[[0-9;]*m/g, ""); // 移除 ANSI 颜色代码

        // 匹配常见提示符格式，提取路径部分
        // 例如: user@host:/path/to/dir$ 或 user@host:/path/to/dir#
        const promptMatch = text.match(/:([\/][^\s$#]+)[\s$#]/);
        if (promptMatch && promptMatch[1] && !promptMatch[1].startsWith('//')) {
          setCurrentDir(promptMatch[1]);
        }
      };

      socket.onopen = () => {
        if (socketRef.current !== socket) {
          return;
        }
        reconnectAttemptRef.current = 0;
        clearNetworkHint();
        syncTerminalSize(term, { force: true });
        [300, 1200].forEach((delay) => {
          window.setTimeout(() => {
            if (socketRef.current === socket && socket.readyState === WebSocket.OPEN) {
              syncTerminalSize(term);
            }
          }, delay);
        });
        setConnectionState("open");
        term.focus();
        if (isReconnect) {
          push(t("重新连接成功", "Reconnected successfully"));
        }
      };

      socket.onerror = () => {
        if (socketRef.current !== socket) {
          return;
        }
        setConnectionState("closed");
        reportNetworkHint("poor", 15000);
      };

      socket.onclose = (event) => {
        if (socketRef.current !== socket) {
          return;
        }
        setConnectionState("closed");
        if (!event.wasClean) {
          reportNetworkHint("poor", 25000);
        }

        // 自动重连逻辑
        if (autoReconnect && !event.wasClean && reconnectAttemptRef.current < 5) {
          const attempt = reconnectAttemptRef.current + 1;
          const delay = attempt * 5000;
          reconnectAttemptRef.current = attempt;

          const reconnectMessage = t(
            `连接已断开，${Math.round(delay / 1000)}秒后自动重连 (${reconnectAttemptRef.current}/5)...`,
            `Connection lost. Auto reconnect in ${Math.round(delay / 1000)}s (${reconnectAttemptRef.current}/5)...`
          );
          term.write(`\r\n\x1b[31m${reconnectMessage}\x1b[0m\r\n`);
          setReconnectCountdown(Math.round(delay / 1000));

          // 倒计时更新
          let countdown = Math.round(delay / 1000);
          if (reconnectCountdownIntervalRef.current) {
            clearInterval(reconnectCountdownIntervalRef.current);
            reconnectCountdownIntervalRef.current = null;
          }
          reconnectCountdownIntervalRef.current = window.setInterval(() => {
            countdown -= 1;
            if (countdown > 0) {
              setReconnectCountdown(countdown);
            } else {
              if (reconnectCountdownIntervalRef.current) {
                clearInterval(reconnectCountdownIntervalRef.current);
                reconnectCountdownIntervalRef.current = null;
              }
            }
          }, 1000);

          reconnectTimerRef.current = window.setTimeout(() => {
            if (reconnectCountdownIntervalRef.current) {
              clearInterval(reconnectCountdownIntervalRef.current);
              reconnectCountdownIntervalRef.current = null;
            }
            connectSocket(term, true);
          }, delay);
        } else if (!event.wasClean) {
          term.write(`\r\n\x1b[31m${t("连接已断开", "Connection lost")}\x1b[0m\r\n`);
          push(t("终端连接已断开", "Terminal connection closed"));
        }
      };
    },
    [sessionId, push, t, syncTerminalSize, autoReconnect, clearReconnectTimer, reportNetworkHint, clearNetworkHint]
  );

  const handleReconnect = React.useCallback(() => {
    const term = terminalInstance.current;
    if (!term) {
      return;
    }
    reconnectAttemptRef.current = 0;
    socketRef.current?.close();
    connectSocket(term, true);
  }, [connectSocket]);

  const handleCancelReconnect = React.useCallback(() => {
    clearReconnectTimer();
    setAutoReconnect(false);
    terminalInstance.current?.write(`\r\n\x1b[33m${t("已取消自动重连", "Auto reconnect canceled")}\x1b[0m\r\n`);
  }, [clearReconnectTimer, t]);

  // 拖拽调整侧边栏宽度
  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      // 最小 50px，最大为容器宽度的 70%
      const maxWidth = containerRect.width * 0.7;
      const clampedWidth = Math.max(50, Math.min(maxWidth, newWidth));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // 主题切换时更新终端颜色
  React.useEffect(() => {
    const term = terminalInstance.current;
    if (!term) return;

    term.options.theme = isDark ? darkTerminalTheme : lightTerminalTheme;
    term.refresh(0, term.rows - 1);
  }, [isDark]);

  // 渚ц竟鏍忓搴﹀彉鍖栨椂淇濆瓨骞惰皟鏁寸粓绔?
  React.useEffect(() => {
    localStorage.setItem("terminal-sidebar-width", String(sidebarWidth));
    const timer = window.setTimeout(() => {
      if (terminalInstance.current) {
        syncTerminalSize(terminalInstance.current);
      }
    }, 10);
    return () => clearTimeout(timer);
  }, [sidebarWidth, syncTerminalSize]);


  const connectionLabel =
    connectionState === "open" ? t("已连接", "Connected") : connectionState === "connecting" ? t("连接中", "Connecting") : t("已断开", "Disconnected");
  const connectionTone =
    connectionState === "open" ? "text-emerald-400" : connectionState === "connecting" ? "text-amber-400" : "text-rose-400";
  const networkProfileLabel =
    sessionNetworkProfile === "good" ? t("网络良好", "Network Good") : sessionNetworkProfile === "degraded" ? t("网络波动", "Network Fluctuating") : t("弱网模式", "Poor Network Mode");
  const networkProfileTone =
    sessionNetworkProfile === "good" ? "text-emerald-400" : sessionNetworkProfile === "degraded" ? "text-amber-400" : "text-rose-400";

  // 获取会话详细信息
  React.useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId)
      .then(setSessionInfo)
      .catch(() => {
        // 静默处理错误
      });
  }, [sessionId]);

  // 定期检测会话状态（根据网络质量动态降频）
  React.useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      timer = window.setTimeout(checkSession, sessionCheckIntervalMs);
    };

    const checkSession = async () => {
      if (sessionCheckInFlightRef.current) {
        scheduleNext();
        return;
      }
      sessionCheckInFlightRef.current = true;
      try {
        const session = await getSession(sessionId);
        setSessionInfo(session);
        if (session.status !== "active") {
          const disconnectedTime = session.disconnected_at ? new Date(session.disconnected_at) : new Date();
          const timeStr = `${disconnectedTime.getFullYear()}-${String(disconnectedTime.getMonth() + 1).padStart(2, '0')}-${String(disconnectedTime.getDate()).padStart(2, '0')} ${String(disconnectedTime.getHours()).padStart(2, '0')}:${String(disconnectedTime.getMinutes()).padStart(2, '0')}:${String(disconnectedTime.getSeconds()).padStart(2, '0')}`;
          setSessionDisconnected((prev) => {
            if (prev?.disconnected && prev.time === timeStr) {
              return prev;
            }
            return { disconnected: true, time: timeStr };
          });
        } else {
          setSessionDisconnected(null);
        }
      } catch {
        // 静默处理错误
      } finally {
        sessionCheckInFlightRef.current = false;
        scheduleNext();
      }
    };
    checkSession(); // 立即检测一次
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, sessionCheckIntervalMs]);

  const handleClear = React.useCallback(() => {
    const term = terminalInstance.current;
    if (!term) {
      return;
    }
    term.clear();
    push(t("已清屏", "Screen cleared"));
  }, [push, t]);

  const handleSelectAll = React.useCallback(() => {
    const term = terminalInstance.current;
    if (!term) {
      return;
    }
    term.selectAll();
    push(t("已全选", "Selected all"));
  }, [push, t]);

  const handleCopySelection = React.useCallback(async () => {
    const termSelection = terminalInstance.current?.getSelection() ?? "";
    const domSelection = window.getSelection()?.toString() ?? "";
    const selection = termSelection || domSelection;
    if (!selection) {
      push(t("没有可复制内容", "No selection to copy"));
      return;
    }

    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = selection;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selection);
        push(t("已复制选中内容", "Copied selection"));
        return;
      }
    } catch {
      // 使用降级方案处理复制失败。
    }

    if (fallbackCopy()) {
      push(t("已复制选中内容", "Copied selection"));
      return;
    }
    push(t("复制失败，请使用右键菜单", "Copy failed, use context menu"));
  }, [push, t]);

  // 使用 ref 保存最新回调，避免 useEffect 依赖变化导致重连
  const connectSocketRef = React.useRef(connectSocket);
  const sendInputRef = React.useRef(sendInput);
  const syncTerminalSizeRef = React.useRef(syncTerminalSize);
  const suppressMouseReportRef = React.useRef(false);

  React.useEffect(() => {
    connectSocketRef.current = connectSocket;
    sendInputRef.current = sendInput;
    syncTerminalSizeRef.current = syncTerminalSize;
  }, [connectSocket, sendInput, syncTerminalSize]);

  React.useEffect(() => {
    const terminalContainer = terminalRef.current;
    if (!terminalContainer || !sessionId) {
      return;
    }
    let disposed = false;
    let term: Terminal | null = null;
    let handleTerminalWheel: ((event: WheelEvent) => void) | null = null;
    let handleTerminalMouseDown: ((event: MouseEvent) => void) | null = null;
    let handleTerminalMouseUp: ((event: MouseEvent) => void) | null = null;
    let handleResize: (() => void) | null = null;

    const initTerminal = async () => {
      try {
        const session = await getSession(sessionId);
        if (disposed) {
          return;
        }
        setSessionInfo(session);
        enhancedSessionRef.current = session.enhanced_enabled === true;
      } catch {
        // 保留当前会话标记，避免初始化失败阻断终端建立。
      }

      if (disposed) {
        return;
      }

      // 读取保存的主题，确保初始化时使用正确主题
      const savedTheme = localStorage.getItem("theme");
      const initialTheme = savedTheme === "light" ? lightTerminalTheme : darkTerminalTheme;

      term = new Terminal({
        theme: initialTheme,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 14,
        cursorBlink: true,
        scrollback: 100000
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(terminalContainer);
      fit.fit();

      terminalInstance.current = term;
      fitAddon.current = fit;

      connectSocketRef.current(term);

      const coreMouseService = (term as unknown as { _core?: { coreMouseService?: { triggerMouseEvent: (event: unknown) => boolean } } })._core
        ?.coreMouseService as { triggerMouseEvent: (event: unknown) => boolean; _wsghTriggerMouseEvent?: (event: unknown) => boolean } | undefined;
      if (coreMouseService && !coreMouseService._wsghTriggerMouseEvent) {
        coreMouseService._wsghTriggerMouseEvent = coreMouseService.triggerMouseEvent.bind(coreMouseService);
        coreMouseService.triggerMouseEvent = (event) => {
          if (suppressMouseReportRef.current) {
            return false;
          }
          return coreMouseService._wsghTriggerMouseEvent?.(event) ?? false;
        };
      }

      term.onData((data) => {
        sendInputRef.current(data);
      });

      let wheelRemainder = 0;
      const sendTmuxWheelPage = (lineDelta: number) => {
        if (lineDelta === 0) {
          return;
        }
        const sequence = lineDelta < 0 ? "\x1b[5~" : "\x1b[6~";
        sendInputRef.current(sequence);
      };
      handleTerminalWheel = (event: WheelEvent) => {
        if (!term) {
          return;
        }
        // 远端程序（含开启 mouse on 的 tmux）接管鼠标时，不拦截滚轮，让 xterm 原样转发。
        if (term.modes.mouseTrackingMode !== "none") {
          return;
        }
        const isEnhancedSession = enhancedSessionRef.current;

        const activeBuffer = term.buffer.active;
        const hasLocalScrollback = activeBuffer.type === "normal" && activeBuffer.baseY > 0;
        // 没有本地历史可滚动时，避免 xterm 默认把滚轮转换为上下方向键（会触发命令历史）。
        // 统一发送 PageUp/PageDown，让 tmux 接管历史翻页。
        if (!hasLocalScrollback) {
          const lineDelta = normalizeWheelDeltaToLines(event, term.rows);
          if (lineDelta === 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          sendTmuxWheelPage(lineDelta);
          return;
        }

        // 统一滚轮行为：只滚动终端输出历史，不把滚轮事件发送到远端会话。
        event.preventDefault();
        event.stopPropagation();

        // 优先驱动 xterm 视口滚动，避免滚轮事件触发远端输入历史。
        const viewport = terminalContainer.querySelector<HTMLElement>(".xterm-viewport");
        if (viewport) {
          const pixelDelta = normalizeWheelDeltaToPixels(event, viewport.clientHeight);
          const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
          const isAtTop = viewport.scrollTop <= 0;
          const isAtBottom = viewport.scrollTop >= maxScrollTop;
          const lineDelta = normalizeWheelDeltaToLines(event, term.rows);

          if (isEnhancedSession && pixelDelta < 0 && isAtTop) {
            sendTmuxWheelPage(lineDelta);
            return;
          }

          if (isEnhancedSession && pixelDelta > 0 && isAtBottom) {
            sendTmuxWheelPage(lineDelta);
            return;
          }

          if (pixelDelta !== 0) {
            const nextScrollTop = Math.min(maxScrollTop, Math.max(0, viewport.scrollTop + pixelDelta));
            viewport.scrollTop = nextScrollTop;
          }
          return;
        }

        const lineDelta = normalizeWheelDeltaToLines(event, term.rows);
        if (lineDelta === 0) {
          return;
        }
        wheelRemainder += lineDelta;
        const wholeLines = wheelRemainder > 0 ? Math.floor(wheelRemainder) : Math.ceil(wheelRemainder);
        if (wholeLines === 0) {
          return;
        }
        term.scrollLines(wholeLines);
        wheelRemainder -= wholeLines;
      };

      terminalContainer.addEventListener("wheel", handleTerminalWheel, { capture: true, passive: false });
      handleTerminalMouseDown = (event: MouseEvent) => {
        if (!term || term.modes.mouseTrackingMode === "none") {
          return;
        }
        if (event.button === 0) {
          suppressMouseReportRef.current = true;
          const selectionService = (term as unknown as { _core?: { _selectionService?: { enable?: () => void; handleMouseDown?: (e: MouseEvent) => void } } })._core
            ?._selectionService;
          if (selectionService?.enable && selectionService?.handleMouseDown) {
            // tmux 开启 mouse on 时强制启用本地选择，避免鼠标事件被 tmux 接管。
            selectionService.enable();
            selectionService.handleMouseDown(event);
            term.focus();
            event.stopPropagation();
          }
          return;
        }
        if (event.button === 2) {
          suppressMouseReportRef.current = true;
          // 右键不交给 tmux，保留浏览器复制/菜单。
          event.stopPropagation();
        }
      };
      handleTerminalMouseUp = () => {
        if (!suppressMouseReportRef.current) {
          return;
        }
        // 延迟恢复，确保本次 mouseup 不再上报给 tmux，避免触发清理选区。
        window.setTimeout(() => {
          suppressMouseReportRef.current = false;
        }, 0);
      };
      terminalContainer.addEventListener("mousedown", handleTerminalMouseDown, { capture: true });
      document.addEventListener("mouseup", handleTerminalMouseUp, { capture: true });

      handleResize = () => {
        if (!term) {
          return;
        }
        syncTerminalSizeRef.current(term);
      };

      window.addEventListener("resize", handleResize);
    };

    void initTerminal();

    return () => {
      disposed = true;
      if (handleTerminalWheel) {
        terminalContainer.removeEventListener("wheel", handleTerminalWheel, { capture: true });
      }
      if (handleTerminalMouseDown) {
        terminalContainer.removeEventListener("mousedown", handleTerminalMouseDown, { capture: true });
      }
      if (handleTerminalMouseUp) {
        document.removeEventListener("mouseup", handleTerminalMouseUp, { capture: true });
      }
      if (handleResize) {
        window.removeEventListener("resize", handleResize);
      }
      clearReconnectTimer();
      socketRef.current?.close();
      term?.dispose();
    };
  }, [sessionId, clearReconnectTimer]);

  return (
    <div className={`flex min-h-screen flex-col transition-colors duration-300 ${isDark ? "bg-slate-950 text-slate-100 dark-scrollbar" : "bg-gray-100 text-slate-900 light-scrollbar"}`}>
      <div className={`border-b px-4 py-3 ${isDark ? "border-slate-800" : "border-slate-200 bg-white"}`}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-700"}`}>
                {sessionInfo?.name || t("会话", "Session")} | {sessionInfo ? new Date(sessionInfo.started_at).toLocaleString() : ""}
              </span>
              <span className={`text-xs ${connectionTone}`}>
                {reconnectCountdown !== null ? t(`重连中 (${reconnectCountdown}s)`, `Reconnecting (${reconnectCountdown}s)`) : connectionLabel}
              </span>
              <span className={`text-xs ${networkProfileTone}`}>{networkProfileLabel}</span>
              {targetLatencyMs !== null ? (
                <div className="flex items-center gap-1">
                  <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>{targetLatencyMs}ms</span>
                  <div
                    className={`flex h-4 w-[100px] items-end gap-px rounded px-1 ${isDark ? "bg-slate-900/60" : "bg-slate-200/70"}`}
                    title={t("近30次网络延迟波动", "Latency trend (last 30 samples)")}
                    aria-label={t("近30次网络延迟波动", "Latency trend (last 30 samples)")}
                  >
                    {latencyBarHeights.map((height, index) => (
                      <span
                        key={index}
                        className={`flex-1 rounded-sm ${height > 0 ? (isDark ? "bg-cyan-400/80" : "bg-cyan-600/80") : "bg-transparent"}`}
                        style={height > 0 ? { height: `${height}px` } : undefined}
                      />
                    ))}
                  </div>
                  {latencyHistoryMaxMs !== null ? (
                    <span
                      className={`text-[10px] whitespace-nowrap ${isDark ? "text-slate-500" : "text-slate-400"}`}
                      title={t("近30次最大延迟", "Max latency in last 30 samples")}
                    >
                      {t("最大", "Max")} {latencyHistoryMaxMs}ms
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {sessionInfo?.note ? (
              <span className={`text-xs mt-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>{sessionInfo.note}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" lightMode={!isDark} onClick={toggleLanguage}>
              {language === "en-US" ? "中文" : "EN"}
            </Button>
            <Button variant="secondary" lightMode={!isDark} onClick={() => navigate("/sessions")}>
              {t("返回会话管理", "Back to Sessions")}
            </Button>
            <Button variant="ghost" lightMode={!isDark} onClick={toggleTheme}>
              {isDark ? t("浅色", "Light") : t("深色", "Dark")}
            </Button>
            <Button variant="ghost" lightMode={!isDark} onClick={handleClear}>
              {t("清屏", "Clear")}
            </Button>
            <Button variant="ghost" lightMode={!isDark} onClick={handleSelectAll}>
              {t("全选", "Select all")}
            </Button>
            {connectionState === "closed" && reconnectCountdown !== null ? (
              <Button variant="ghost" lightMode={!isDark} onClick={handleCancelReconnect}>
                {t("取消重连", "Cancel reconnect")}
              </Button>
            ) : null}
            {connectionState === "closed" && reconnectCountdown === null ? (
              <Button variant="secondary" lightMode={!isDark} onClick={handleReconnect}>
                {t("重连", "Reconnect")}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              lightMode={!isDark}
              onClick={handleCopySelection}
            >
              {t("复制", "Copy")}
            </Button>
          </div>
        </div>
      </div>
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          {/* 终端窗口 */}
          <div className="flex-1 p-4 pb-2 min-h-0">
            <div
              ref={terminalRef}
              className={`h-full w-full rounded-lg border ${isDark ? "border-slate-800" : "border-slate-300 xterm-light"} ${sessionInfo?.enhanced_enabled ? "xterm-tmux-enhanced" : ""}`}
              tabIndex={-1}
              onClick={() => terminalInstance.current?.focus()}
            />
          </div>
          {/* 文件浏览器 */}
          <div className={`p-4 pt-2 ${isDark ? "border-t border-slate-800" : "border-t border-slate-200"}`} style={{ height: "280px" }}>
            {sessionId ? (
              <FileBrowser
                sessionId={sessionId}
                isDark={isDark}
                currentDir={currentDir}
                onFileSelect={setSelectedFilePath}
                networkProfile={sessionNetworkProfile}
              />
            ) : null}
          </div>
        </div>
        {/* 拖拽分隔条 */}
        <div
          onMouseDown={handleMouseDown}
          className={`w-1 cursor-col-resize transition-colors hidden lg:block ${
            isDragging
              ? (isDark ? "bg-indigo-500" : "bg-indigo-400")
              : (isDark ? "bg-slate-800 hover:bg-slate-700" : "bg-slate-200 hover:bg-slate-300")
          }`}
        />
        <div
          style={{ width: sidebarWidth }}
          className={`p-4 hidden lg:block flex-shrink-0 overflow-y-auto ${isDark ? "bg-slate-900/50 dark-scrollbar" : "bg-white border-l border-slate-200 light-scrollbar"}`}
        >
          {sessionId ? (
            <SystemMonitor
              sessionId={sessionId}
              isDark={isDark}
              selectedFilePath={selectedFilePath || undefined}
              networkProfile={sessionNetworkProfile}
            />
          ) : null}
        </div>
      </div>
      {/* 拖拽时的遮罩层，防止 iframe 等元素捕获鼠标事件 */}
      {isDragging ? <div className="fixed inset-0 z-50 cursor-col-resize" /> : null}
      {/* 会话断开遮罩层 */}
      {sessionDisconnected?.disconnected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950">
          <div className="text-center">
            <div className="text-2xl mb-4 text-rose-400">{t("会话已断开", "Session disconnected")}</div>
            <div className="text-sm text-slate-400">{t("断开时间", "Disconnected at")}: {sessionDisconnected.time}</div>
          </div>
        </div>
      )}
    </div>
  );
}



