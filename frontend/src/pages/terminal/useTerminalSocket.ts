import React from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { clearAuthStorage, getSession, getStoredToken, openTerminalSocket } from "../../lib/api";
import {
  darkTerminalTheme,
  lightTerminalTheme,
  normalizeWheelDeltaToLines,
  normalizeWheelDeltaToPixels,
  sanitizeTerminalOutputChunk,
} from "./terminalUtils";

type TerminalSocketOptions = {
  sessionId?: string;
  t: (zh: string, en: string) => string;
  push: (message: string) => void;
  reportNetworkHint: (profile: "degraded" | "poor", durationMs: number) => void;
  clearNetworkHint: () => void;
  enhancedSessionRef: React.MutableRefObject<boolean>;
  setCurrentDir: (dir: string) => void;
};

type ResizeState = { socket: WebSocket; rows: number; cols: number };

export function useTerminalSocket({
  sessionId,
  t,
  push,
  reportNetworkHint,
  clearNetworkHint,
  enhancedSessionRef,
  setCurrentDir,
}: TerminalSocketOptions) {
  const terminalRef = React.useRef<HTMLDivElement | null>(null);
  const terminalInstance = React.useRef<Terminal | null>(null);
  const fitAddon = React.useRef<FitAddon | null>(null);
  const socketRef = React.useRef<WebSocket | null>(null);
  const reconnectTimerRef = React.useRef<number | null>(null);
  const reconnectCountdownIntervalRef = React.useRef<number | null>(null);
  const reconnectAttemptRef = React.useRef(0);
  const lastResizeStateRef = React.useRef<ResizeState | null>(null);
  const suppressMouseReportRef = React.useRef(false);
  const [connectionState, setConnectionState] = React.useState<"connecting" | "open" | "closed">("connecting");
  const [autoReconnect, setAutoReconnect] = React.useState(true);
  const [reconnectCountdown, setReconnectCountdown] = React.useState<number | null>(null);

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
        const text = output.replace(/\x1b\[[0-9;]*m/g, "");
        const promptMatch = text.match(/:([/][^\s$#]+)[\s$#]/);
        if (promptMatch && promptMatch[1] && !promptMatch[1].startsWith("//")) {
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

        if (autoReconnect && !event.wasClean && reconnectAttemptRef.current < 5) {
          const schedule = [2, 4, 8, 16, 32];
          const attempt = reconnectAttemptRef.current + 1;
          const delaySeconds = schedule[attempt - 1] ?? schedule[schedule.length - 1];
          const delay = delaySeconds * 1000;
          reconnectAttemptRef.current = attempt;

          const reconnectMessage = t(
            `连接已断开，${delaySeconds}秒后自动重连 (${reconnectAttemptRef.current}/5)...`,
            `Connection lost. Auto reconnect in ${delaySeconds}s (${reconnectAttemptRef.current}/5)...`
          );
          term.write(`\r\n\x1b[31m${reconnectMessage}\x1b[0m\r\n`);
          setReconnectCountdown(Math.round(delay / 1000));

          let countdown = Math.round(delay / 1000);
          if (reconnectCountdownIntervalRef.current) {
            clearInterval(reconnectCountdownIntervalRef.current);
            reconnectCountdownIntervalRef.current = null;
          }
          reconnectCountdownIntervalRef.current = window.setInterval(() => {
            countdown -= 1;
            if (countdown > 0) {
              setReconnectCountdown(countdown);
            } else if (reconnectCountdownIntervalRef.current) {
              clearInterval(reconnectCountdownIntervalRef.current);
              reconnectCountdownIntervalRef.current = null;
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
    [sessionId, clearReconnectTimer, t, syncTerminalSize, push, reportNetworkHint, clearNetworkHint, autoReconnect, enhancedSessionRef, setCurrentDir]
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

  const connectSocketRef = React.useRef(connectSocket);
  const sendInputRef = React.useRef(sendInput);
  const syncTerminalSizeRef = React.useRef(syncTerminalSize);
  const scrollTerminal = React.useCallback((direction: "up" | "down", mode: "auto" | "remote" = "auto") => {
    const term = terminalInstance.current;
    const container = terminalRef.current;
    if (!term || !container) {
      return;
    }
    const lineDelta = direction === "up" ? -8 : 8;
    const sendTmuxWheelPage = (delta: number) => {
      if (delta === 0) {
        return;
      }
      const sequence = delta < 0 ? "\x1b[5~" : "\x1b[6~";
      sendInput(sequence);
    };
    const sendTmuxMouseWheel = (delta: number) => {
      if (delta === 0) {
        return;
      }
      const col = Math.max(1, Math.floor(term.cols / 2));
      const row = Math.max(1, Math.floor(term.rows / 2));
      const code = delta < 0 ? 64 : 65;
      sendInput(`\x1b[<${code};${col};${row}M`);
    };
    if (mode === "remote") {
      if (enhancedSessionRef.current && term.modes.mouseTrackingMode !== "none") {
        sendTmuxMouseWheel(lineDelta);
        return;
      }
      if (enhancedSessionRef.current) {
        term.scrollLines(lineDelta);
        return;
      }
      term.scrollLines(lineDelta);
      return;
    }
    const activeBuffer = term.buffer.active;
    const hasLocalScrollback = activeBuffer.type === "normal" && activeBuffer.baseY > 0;
    if (!hasLocalScrollback) {
      sendTmuxWheelPage(lineDelta);
      return;
    }
    const viewport = container.querySelector<HTMLElement>(".xterm-viewport");
    if (viewport) {
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const isAtTop = viewport.scrollTop <= 0;
      const isAtBottom = viewport.scrollTop >= maxScrollTop;
      const isEnhancedSession = enhancedSessionRef.current;
      if (isEnhancedSession && lineDelta < 0 && isAtTop) {
        sendTmuxWheelPage(lineDelta);
        return;
      }
      if (isEnhancedSession && lineDelta > 0 && isAtBottom) {
        sendTmuxWheelPage(lineDelta);
        return;
      }
    }
    term.scrollLines(lineDelta);
  }, [sendInput, enhancedSessionRef]);

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
        if (!disposed) {
          enhancedSessionRef.current = session.enhanced_enabled === true;
        }
      } catch {
        // 忽略初始化会话信息失败
      }

      if (disposed) {
        return;
      }

      const savedTheme = localStorage.getItem("theme");
      const initialTheme = savedTheme === "light" ? "light" : "dark";

      term = new Terminal({
        theme: initialTheme === "light" ? lightTerminalTheme : darkTerminalTheme,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 14,
        cursorBlink: true,
        scrollback: 100000,
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
        if (term.modes.mouseTrackingMode !== "none") {
          return;
        }
        const isEnhancedSession = enhancedSessionRef.current;

        const activeBuffer = term.buffer.active;
        const hasLocalScrollback = activeBuffer.type === "normal" && activeBuffer.baseY > 0;
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

        event.preventDefault();
        event.stopPropagation();

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
            selectionService.enable();
            selectionService.handleMouseDown(event);
            term.focus();
            event.stopPropagation();
          }
          return;
        }
        if (event.button === 2) {
          suppressMouseReportRef.current = true;
          event.stopPropagation();
        }
      };
      handleTerminalMouseUp = () => {
        if (!suppressMouseReportRef.current) {
          return;
        }
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
  }, [sessionId, clearReconnectTimer, enhancedSessionRef]);

  return {
    terminalRef,
    terminalInstance,
    fitAddon,
    connectionState,
    reconnectCountdown,
    autoReconnect,
    setAutoReconnect,
    syncTerminalSize,
    scrollTerminal,
    handleReconnect,
    handleCancelReconnect,
  };
}
