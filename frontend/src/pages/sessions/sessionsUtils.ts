export function localizeText(language: string, zh: string, en: string): string {
  return language === "en-US" ? en : zh;
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
