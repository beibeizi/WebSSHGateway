import React from "react";
import { getSessionStatusSummary, Session, SessionStatusSummary } from "../../lib/api";

export type SessionStatusEntry = {
  summary: SessionStatusSummary | null;
  loading: boolean;
  error: boolean;
};

const MAX_CONCURRENT_REQUESTS = 3;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
) {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      await task(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export function useSessionStatusSummary(visibleSessions: Session[], enabled: boolean, pollIntervalMs: number) {
  const activeSessionIds = React.useMemo(
    () => visibleSessions.filter((session) => session.status === "active").map((session) => session.id),
    [visibleSessions]
  );
  const [statusEntries, setStatusEntries] = React.useState<Record<string, SessionStatusEntry>>({});
  const inFlightRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const versionRef = React.useRef(0);

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    versionRef.current += 1;
  }, [activeSessionIds, enabled]);

  React.useEffect(() => {
    setStatusEntries((prev) => {
      const next: Record<string, SessionStatusEntry> = {};
      activeSessionIds.forEach((sessionId) => {
        if (prev[sessionId]) {
          next[sessionId] = prev[sessionId];
        }
      });
      return next;
    });
    if (activeSessionIds.length === 0) {
      inFlightRef.current = false;
    }
  }, [activeSessionIds]);

  const fetchStatuses = React.useCallback(async () => {
    if (!enabled || activeSessionIds.length === 0 || inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    const currentIds = [...activeSessionIds];
    const currentVersion = versionRef.current;

    setStatusEntries((prev) => {
      const next: Record<string, SessionStatusEntry> = {};
      currentIds.forEach((sessionId) => {
        const existing = prev[sessionId];
        next[sessionId] = existing
          ? { ...existing, loading: true, error: false }
          : { summary: null, loading: true, error: false };
      });
      return next;
    });

    const summaries = new Map<string, SessionStatusSummary>();
    const failedIds = new Set<string>();

    try {
      await runWithConcurrency(currentIds, MAX_CONCURRENT_REQUESTS, async (sessionId) => {
        try {
          const summary = await getSessionStatusSummary(sessionId);
          summaries.set(sessionId, summary);
        } catch {
          failedIds.add(sessionId);
        }
      });

      if (!mountedRef.current || currentVersion !== versionRef.current) {
        return;
      }

      setStatusEntries((prev) => {
        const next: Record<string, SessionStatusEntry> = {};
        currentIds.forEach((sessionId) => {
          const existing = prev[sessionId];
          const summary = summaries.get(sessionId) ?? existing?.summary ?? null;
          next[sessionId] = {
            summary,
            loading: false,
            error: failedIds.has(sessionId),
          };
        });
        return next;
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [activeSessionIds, enabled]);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    void fetchStatuses();
    const timer = window.setInterval(() => {
      void fetchStatuses();
    }, Math.max(1000, pollIntervalMs));

    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, fetchStatuses, pollIntervalMs]);

  return statusEntries;
}
