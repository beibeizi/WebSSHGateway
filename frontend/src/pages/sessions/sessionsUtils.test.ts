import {
  buildSessionGroups,
  formatBytesPerSecond,
  reorderSessionsWithinConnection,
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

function test(name: string, run: () => void) {
  run();
  console.log(`PASS ${name}`);
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
