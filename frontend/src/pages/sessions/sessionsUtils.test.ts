import { it } from "vitest";
import {
  buildSessionGroups,
  formatBytesPerSecond,
  getFreshSessionStatusSummaries,
  mergeSessionStatusSummaryCache,
  pruneSessionStatusSummaryCache,
  readSessionStatusSummaryCache,
  readSessionViewMode,
  reorderSessionsWithinConnection,
  SESSION_STATUS_SUMMARY_CACHE_KEY,
  SESSION_VIEW_MODE_STORAGE_KEY,
  writeSessionStatusSummaryCache,
  writeSessionViewMode,
} from "./sessionsUtils";

type TestSession = {
  id: string;
  connection_id: number;
  status: string;
  started_at: string;
  last_activity: string;
  name: string;
  host: string;
  username: string;
};

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

const test = it;

class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }
}

const sessions: TestSession[] = [
  {
    id: "session-a",
    connection_id: 2,
    status: "active",
    started_at: "2026-01-01T00:00:00.000Z",
    last_activity: "2026-01-01T00:10:00.000Z",
    name: "会话 A",
    host: "alpha.example.com",
    username: "root",
  },
  {
    id: "session-b",
    connection_id: 1,
    status: "disconnected",
    started_at: "2026-01-01T00:01:00.000Z",
    last_activity: "2026-01-01T00:11:00.000Z",
    name: "会话 B",
    host: "beta.example.com",
    username: "deploy",
  },
  {
    id: "session-c",
    connection_id: 2,
    status: "disconnected",
    started_at: "2026-01-01T00:02:00.000Z",
    last_activity: "2026-01-01T00:12:00.000Z",
    name: "会话 C",
    host: "alpha.example.com",
    username: "root",
  },
  {
    id: "session-d",
    connection_id: 2,
    status: "active",
    started_at: "2026-01-01T00:03:00.000Z",
    last_activity: "2026-01-01T00:13:00.000Z",
    name: "会话 D",
    host: "alpha.example.com",
    username: "root",
  },
];

const connections = [
  {
    id: 1,
    name: "Beta",
    host: "beta.example.com",
    port: 22,
    username: "deploy",
  },
  {
    id: 2,
    name: "Alpha",
    host: "alpha.example.com",
    port: 2222,
    username: "root",
  },
];

const sampleSummary = {
  stats: {
    cpu: { percent: 12.5, count: 4 },
    memory: { total: 8000, used: 3200, percent: 40 },
    swap: { total: 0, used: 0, percent: 0 },
  },
  network: {
    upload_speed: 1024,
    download_speed: 2048,
  },
};

test("按 connection_id 分组并保留筛选后的首次出现顺序", () => {
  const groups = buildSessionGroups(sessions, connections);

  assertDeepEqual(groups.map((group) => group.connectionId), [2, 1], "分组顺序");
  assertDeepEqual(groups[0].sessions.map((session) => session.id), ["session-a", "session-c", "session-d"], "组内顺序");
  assertEqual(groups[0].activeCount, 2, "在线数量");
  assertEqual(groups[0].offlineCount, 1, "离线数量");
  assertEqual(groups[0].lastActivity, "2026-01-01T00:13:00.000Z", "最近活动");
  assertEqual(groups[0].representativeActiveSession?.id, "session-d", "代表 active 会话");
  assertEqual(groups[0].connection?.name, "Alpha", "连接信息");
});

test("组内排序只替换同 connection_id 的会话位置", () => {
  const nextOrder = reorderSessionsWithinConnection(
    ["session-a", "session-b", "session-c", "session-d"],
    sessions,
    2,
    "session-d",
    "session-a"
  );

  assertDeepEqual(nextOrder, ["session-d", "session-b", "session-a", "session-c"], "跨组位置保持不变");
});

test("组内排序拒绝跨 connection_id 的目标", () => {
  const nextOrder = reorderSessionsWithinConnection(
    ["session-a", "session-b", "session-c", "session-d"],
    sessions,
    2,
    "session-a",
    "session-b"
  );

  assertDeepEqual(nextOrder, ["session-a", "session-b", "session-c", "session-d"], "跨组排序不生效");
});

test("格式化网络速率", () => {
  assertEqual(formatBytesPerSecond(0), "0 B/s", "零速率");
  assertEqual(formatBytesPerSecond(2048), "2.0 KB/s", "KB 速率");
  assertEqual(formatBytesPerSecond(1048576), "1.0 MB/s", "MB 速率");
});

test("展示模式持久化只接受列表和分组模式", () => {
  const storage = new MemoryStorage();

  storage.setItem(SESSION_VIEW_MODE_STORAGE_KEY, "grouped");
  assertEqual(readSessionViewMode(storage), "grouped", "读取分组模式");

  storage.setItem(SESSION_VIEW_MODE_STORAGE_KEY, "grid");
  assertEqual(readSessionViewMode(storage), "list", "非法值回退列表模式");

  writeSessionViewMode(storage, "grouped");
  assertEqual(storage.getItem(SESSION_VIEW_MODE_STORAGE_KEY), "grouped", "写入合法值");

  writeSessionViewMode(storage, "grid");
  assertEqual(storage.getItem(SESSION_VIEW_MODE_STORAGE_KEY), "list", "写入非法值时规范化");
});

test("状态摘要缓存只恢复 30 秒内且仍在线的会话", () => {
  const cache = {
    "session-a": { summary: sampleSummary, cachedAt: 100000 },
    "session-b": { summary: sampleSummary, cachedAt: 69999 },
    "session-c": { summary: sampleSummary, cachedAt: 99999 },
  };

  const summaries = getFreshSessionStatusSummaries(cache, ["session-a", "session-b"], 100000, 30000);

  assertDeepEqual(Object.keys(summaries), ["session-a"], "仅恢复未过期且仍在线的状态");
});

test("状态摘要缓存写入时只保存 summary 和 cachedAt", () => {
  const storage = new MemoryStorage();
  const cache = mergeSessionStatusSummaryCache({}, { "session-a": sampleSummary }, 120000);

  writeSessionStatusSummaryCache(storage, cache);

  const raw = JSON.parse(storage.getItem(SESSION_STATUS_SUMMARY_CACHE_KEY) ?? "{}") as Record<string, unknown>;
  assertDeepEqual(raw["session-a"], { summary: sampleSummary, cachedAt: 120000 }, "缓存结构");
  assertEqual(Object.prototype.hasOwnProperty.call(raw["session-a"], "loading"), false, "不缓存 loading");
  assertEqual(Object.prototype.hasOwnProperty.call(raw["session-a"], "error"), false, "不缓存 error");
  assertDeepEqual(readSessionStatusSummaryCache<typeof sampleSummary>(storage), cache, "读取缓存");
});

test("状态摘要缓存会裁剪非当前在线会话", () => {
  const cache = {
    "session-a": { summary: sampleSummary, cachedAt: 120000 },
    "session-b": { summary: sampleSummary, cachedAt: 120000 },
  };

  const pruned = pruneSessionStatusSummaryCache(cache, ["session-b"]);

  assertDeepEqual(Object.keys(pruned), ["session-b"], "只保留当前在线会话");
});
