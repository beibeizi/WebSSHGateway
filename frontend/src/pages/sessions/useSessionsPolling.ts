import React from "react";
import type { Session } from "../../lib/api";
import { clearAuthStorage, getStoredToken, listSessions, openSessionSocket } from "../../lib/api";

type UseSessionsPollingOptions = {
  sessionsPollIntervalMs: number;
  preserveOrderIfDragging: (list: Session[]) => Session[];
  sessionsRef: React.MutableRefObject<Session[]>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setNoteDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  push: (message: string) => void;
  t: (zh: string, en: string) => string;
  reportNetworkHint: (profile: "degraded" | "poor", durationMs: number) => void;
};

export function useSessionsPolling({
  sessionsPollIntervalMs,
  preserveOrderIfDragging,
  sessionsRef,
  setSessions,
  setNoteDrafts,
  push,
  t,
  reportNetworkHint,
}: UseSessionsPollingOptions) {
  const sessionPollInFlightRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const scheduleNext = () => {
      if (cancelled) return;
      timer = window.setTimeout(run, sessionsPollIntervalMs);
    };

    const run = async () => {
      if (sessionPollInFlightRef.current) {
        scheduleNext();
        return;
      }
      sessionPollInFlightRef.current = true;
      try {
        const sessionList = await listSessions();
        setSessions(preserveOrderIfDragging(sessionList));
        setNoteDrafts((prev) => {
          const previousSessions = sessionsRef.current;
          const next = { ...prev };
          sessionList.forEach((session) => {
            if (!(session.id in next)) {
              next[session.id] = session.note ?? "";
              return;
            }
            const previousSession = previousSessions.find((item) => item.id === session.id);
            if (next[session.id] === (previousSession?.note ?? "")) {
              next[session.id] = session.note ?? "";
            }
          });
          return next;
        });
      } catch {
        // 静默处理刷新错误
      } finally {
        sessionPollInFlightRef.current = false;
        scheduleNext();
      }
    };

    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionsPollIntervalMs, preserveOrderIfDragging, setSessions, setNoteDrafts, sessionsRef]);

  React.useEffect(() => {
    const userId = localStorage.getItem("user_id") || sessionStorage.getItem("user_id");
    const token = getStoredToken();
    if (!userId || !token) {
      clearAuthStorage();
      window.location.href = "/";
      return;
    }
    const socket = openSessionSocket(Number(userId));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as Partial<Session> & { status?: string };
        if (payload.id && payload.status === "deleted") {
          setSessions((prev) => prev.filter((item) => item.id !== payload.id));
          return;
        }
        setSessions((prev) => {
          const existing = prev.find((item) => item.id === payload.id);
          if (existing) {
            return prev.map((item) => (item.id === payload.id ? { ...item, ...payload } as Session : item));
          }
          if (payload.id) {
            return [...prev, payload as Session];
          }
          return prev;
        });
        if (payload.id && "note" in payload) {
          setNoteDrafts((prev) => ({ ...prev, [payload.id as string]: payload.note ?? "" }));
        }
      } catch {
        // ignore malformed payloads
      }
    };
    let warned = false;
    socket.onerror = () => {
      if (!warned) {
        push(t("会话状态连接失败", "Session status connection failed"));
        warned = true;
      }
      reportNetworkHint("degraded", 15000);
    };
    socket.onclose = (event) => {
      if (!event.wasClean && !warned) {
        push(t("会话状态连接已断开", "Session status connection closed"));
        warned = true;
      }
      if (!event.wasClean) {
        reportNetworkHint("poor", 25000);
      }
    };
    return () => socket.close();
  }, [push, reportNetworkHint, setSessions, setNoteDrafts, t]);
}
