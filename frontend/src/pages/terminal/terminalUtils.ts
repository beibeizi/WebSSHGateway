import type { NetworkProfile } from "../../context/AppContext";

export type TargetNetworkProfile = "good" | "degraded" | "poor" | "unknown";

export const NETWORK_PROFILE_RANK: Record<NetworkProfile, number> = {
  good: 0,
  degraded: 1,
  poor: 2,
};

export function pickWorseProfile(a: NetworkProfile, b: NetworkProfile): NetworkProfile {
  return NETWORK_PROFILE_RANK[a] >= NETWORK_PROFILE_RANK[b] ? a : b;
}

export function normalizeTargetNetworkProfile(raw: string | undefined | null): TargetNetworkProfile {
  if (raw === "good" || raw === "degraded" || raw === "poor") {
    return raw;
  }
  return "unknown";
}

export const darkTerminalTheme = {
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

export const lightTerminalTheme = {
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

export const WHEEL_PIXEL_PER_LINE = 40;
export const LATENCY_HISTORY_SIZE = 30;
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

export function normalizeWheelDeltaToLines(event: WheelEvent, terminalRows: number): number {
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

export function normalizeWheelDeltaToPixels(event: WheelEvent, viewportHeight: number): number {
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

export function sanitizeTerminalOutputChunk(
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
