import React from "react";
import type { NetworkProfile } from "../../context/AppContext";
import { getSession, Session } from "../../lib/api";
import {
  LATENCY_HISTORY_SIZE,
  normalizeTargetNetworkProfile,
  pickWorseProfile,
  TargetNetworkProfile,
} from "./terminalUtils";

type TerminalSessionInfoOptions = {
  sessionId?: string;
  globalNetworkProfile: NetworkProfile;
  connectionState: "connecting" | "open" | "closed";
  reconnectCountdown: number | null;
  enhancedSessionRef: React.MutableRefObject<boolean>;
};

export function useTerminalSessionInfo({
  sessionId,
  globalNetworkProfile,
  connectionState,
  reconnectCountdown,
  enhancedSessionRef,
}: TerminalSessionInfoOptions) {
  const [sessionInfo, setSessionInfo] = React.useState<Session | null>(null);
  const [targetLatencyHistory, setTargetLatencyHistory] = React.useState<number[]>([]);
  const [sessionDisconnected, setSessionDisconnected] = React.useState<{ disconnected: boolean; time: string } | null>(null);
  const sessionCheckInFlightRef = React.useRef(false);

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

  React.useEffect(() => {
    setTargetLatencyHistory([]);
  }, [sessionId]);

  React.useEffect(() => {
    enhancedSessionRef.current = sessionInfo?.enhanced_enabled === true;
  }, [sessionInfo?.enhanced_enabled, enhancedSessionRef]);

  React.useEffect(() => {
    if (targetLatencyMs === null) {
      return;
    }
    setTargetLatencyHistory((prev) => [...prev.slice(-(LATENCY_HISTORY_SIZE - 1)), targetLatencyMs]);
  }, [targetLatencyMs]);

  React.useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId)
      .then(setSessionInfo)
      .catch(() => {
        // 静默处理错误
      });
  }, [sessionId]);

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
          const timeStr = `${disconnectedTime.getFullYear()}-${String(disconnectedTime.getMonth() + 1).padStart(2, "0")}-${String(disconnectedTime.getDate()).padStart(2, "0")} ${String(disconnectedTime.getHours()).padStart(2, "0")}:${String(disconnectedTime.getMinutes()).padStart(2, "0")}:${String(disconnectedTime.getSeconds()).padStart(2, "0")}`;
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
    checkSession();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, sessionCheckIntervalMs]);

  return {
    sessionInfo,
    setSessionInfo,
    targetLatencyMs,
    latencyBarHeights,
    latencyHistoryMaxMs,
    sessionNetworkProfile,
    sessionDisconnected,
  };
}
