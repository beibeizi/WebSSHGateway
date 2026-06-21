export function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
}

export type SessionViewMode = "list" | "grouped";

export const SESSION_VIEW_MODE_STORAGE_KEY = "webssh:sessions:viewMode:v1";
export const SESSION_STATUS_SUMMARY_CACHE_KEY = "webssh:sessionStatusSummary:v1";
export const SESSION_STATUS_SUMMARY_CACHE_TTL_MS = 30000;

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem"> & Partial<Pick<Storage, "removeItem">>;

export type SessionStatusSummaryCacheRecord<TSummary> = {
  summary: TSummary;
  cachedAt: number;
};

export type SessionStatusSummaryCache<TSummary> = Record<string, SessionStatusSummaryCacheRecord<TSummary>>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSessionViewMode(value: unknown): SessionViewMode {
  return value === "grouped" ? "grouped" : "list";
}

export function readSessionViewMode(storage?: ReadableStorage | null): SessionViewMode {
  try {
    return normalizeSessionViewMode(storage?.getItem(SESSION_VIEW_MODE_STORAGE_KEY));
  } catch {
    return "list";
  }
}

export function writeSessionViewMode(storage: Pick<Storage, "setItem"> | null | undefined, value: unknown) {
  try {
    storage?.setItem(SESSION_VIEW_MODE_STORAGE_KEY, normalizeSessionViewMode(value));
  } catch {
    // 浏览器可能因隐私设置禁用 storage，展示模式退回本次内存状态即可。
  }
}

export function readSessionStatusSummaryCache<TSummary>(
  storage?: ReadableStorage | null
): SessionStatusSummaryCache<TSummary> {
  try {
    const raw = storage?.getItem(SESSION_STATUS_SUMMARY_CACHE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainRecord(parsed)) {
      return {};
    }

    const cache: SessionStatusSummaryCache<TSummary> = {};
    Object.entries(parsed).forEach(([sessionId, value]) => {
      if (!isPlainRecord(value)) {
        return;
      }
      const cachedAt = value.cachedAt;
      if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt)) {
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(value, "summary") || value.summary == null) {
        return;
      }
      cache[sessionId] = {
        summary: value.summary as TSummary,
        cachedAt,
      };
    });
    return cache;
  } catch {
    return {};
  }
}

export function writeSessionStatusSummaryCache<TSummary>(
  storage: WritableStorage | null | undefined,
  cache: SessionStatusSummaryCache<TSummary>
) {
  try {
    if (Object.keys(cache).length === 0) {
      storage?.removeItem?.(SESSION_STATUS_SUMMARY_CACHE_KEY);
      return;
    }
    storage?.setItem(SESSION_STATUS_SUMMARY_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 临时缓存写入失败不应影响会话页主流程。
  }
}

export function getFreshSessionStatusSummaries<TSummary>(
  cache: SessionStatusSummaryCache<TSummary>,
  activeSessionIds: string[],
  nowMs: number,
  ttlMs = SESSION_STATUS_SUMMARY_CACHE_TTL_MS
): Record<string, TSummary> {
  const summaries: Record<string, TSummary> = {};
  activeSessionIds.forEach((sessionId) => {
    const entry = cache[sessionId];
    if (!entry) {
      return;
    }
    const ageMs = nowMs - entry.cachedAt;
    if (ageMs >= 0 && ageMs <= ttlMs) {
      summaries[sessionId] = entry.summary;
    }
  });
  return summaries;
}

export function pruneSessionStatusSummaryCache<TSummary>(
  cache: SessionStatusSummaryCache<TSummary>,
  activeSessionIds: string[]
): SessionStatusSummaryCache<TSummary> {
  const activeSessionIdSet = new Set(activeSessionIds);
  const next: SessionStatusSummaryCache<TSummary> = {};
  Object.entries(cache).forEach(([sessionId, entry]) => {
    if (activeSessionIdSet.has(sessionId)) {
      next[sessionId] = entry;
    }
  });
  return next;
}

export function mergeSessionStatusSummaryCache<TSummary>(
  cache: SessionStatusSummaryCache<TSummary>,
  summaries: Record<string, TSummary>,
  cachedAt: number
): SessionStatusSummaryCache<TSummary> {
  const next: SessionStatusSummaryCache<TSummary> = { ...cache };
  Object.entries(summaries).forEach(([sessionId, summary]) => {
    next[sessionId] = { summary, cachedAt };
  });
  return next;
}

const NETWORK_PROFILE_RANK: Record<"good" | "degraded" | "poor", number> = {
  good: 0,
  degraded: 1,
  poor: 2,
};

export function pickWorseProfile(
  a: "good" | "degraded" | "poor",
  b: "good" | "degraded" | "poor"
): "good" | "degraded" | "poor" {
  return NETWORK_PROFILE_RANK[a] >= NETWORK_PROFILE_RANK[b] ? a : b;
}

export function normalizeTargetProfile(raw: string | undefined | null): "good" | "degraded" | "poor" | "unknown" {
  if (raw === "good" || raw === "degraded" || raw === "poor") {
    return raw;
  }
  return "unknown";
}

export function moveItem<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function mergeVisibleOrder(
  fullOrder: string[],
  visibleOrder: string[],
  nextVisibleOrder: string[]
): string[] {
  const visibleSet = new Set(visibleOrder);
  let visibleIndex = 0;
  return fullOrder.map((id) => {
    if (!visibleSet.has(id)) {
      return id;
    }
    const nextId = nextVisibleOrder[visibleIndex];
    visibleIndex += 1;
    return nextId;
  });
}

export type GroupableSession = {
  id: string;
  connection_id: number;
  status: string;
  started_at: string;
  last_activity: string;
  name: string;
  host: string;
  username: string;
};

export type GroupableConnection = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  remote_probe_status?: string | null;
  remote_probe_error?: string | null;
  remote_probe_checked_at?: string | null;
  remote_arch?: string | null;
  remote_os?: string | null;
  enhanced_supported?: boolean;
};

export type SessionGroup<
  TSession extends GroupableSession = GroupableSession,
  TConnection extends GroupableConnection = GroupableConnection,
> = {
  connectionId: number;
  connection?: TConnection;
  sessions: TSession[];
  activeCount: number;
  offlineCount: number;
  lastActivity: string | null;
  representativeActiveSession?: TSession;
};

function isAfter(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) {
    return false;
  }
  if (!b) {
    return true;
  }
  return new Date(a).getTime() > new Date(b).getTime();
}

export function buildSessionGroups<
  TSession extends GroupableSession,
  TConnection extends GroupableConnection,
>(sessions: TSession[], connections: TConnection[]): SessionGroup<TSession, TConnection>[] {
  const connectionMap = new Map(connections.map((connection) => [connection.id, connection]));
  const groupMap = new Map<number, SessionGroup<TSession, TConnection>>();

  sessions.forEach((session) => {
    const existingGroup = groupMap.get(session.connection_id);
    const group = existingGroup ?? {
      connectionId: session.connection_id,
      connection: connectionMap.get(session.connection_id),
      sessions: [],
      activeCount: 0,
      offlineCount: 0,
      lastActivity: null,
      representativeActiveSession: undefined,
    };

    group.sessions.push(session);
    if (session.status === "active") {
      group.activeCount += 1;
      if (
        !group.representativeActiveSession
        || isAfter(session.last_activity, group.representativeActiveSession.last_activity)
      ) {
        group.representativeActiveSession = session;
      }
    } else {
      group.offlineCount += 1;
    }
    if (isAfter(session.last_activity, group.lastActivity)) {
      group.lastActivity = session.last_activity;
    }

    if (!existingGroup) {
      groupMap.set(session.connection_id, group);
    }
  });

  return Array.from(groupMap.values());
}

export function reorderSessionsWithinConnection<TSession extends GroupableSession>(
  fullOrder: string[],
  visibleSessions: TSession[],
  connectionId: number,
  fromSessionId: string,
  toSessionId: string
): string[] {
  const scopedOrder = visibleSessions
    .filter((session) => session.connection_id === connectionId)
    .map((session) => session.id);
  const fromIndex = scopedOrder.indexOf(fromSessionId);
  const toIndex = scopedOrder.indexOf(toSessionId);

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return fullOrder;
  }

  return mergeVisibleOrder(fullOrder, scopedOrder, moveItem(scopedOrder, fromIndex, toIndex));
}

export function formatBytesPerSecond(bytesPerSec: number): string {
  if (bytesPerSec <= 0) {
    return "0 B/s";
  }

  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const base = 1024;
  const unitIndex = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(base)), units.length - 1);
  const value = bytesPerSec / Math.pow(base, unitIndex);
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}
