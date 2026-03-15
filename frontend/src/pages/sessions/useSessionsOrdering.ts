import React from "react";
import type { Session } from "../../lib/api";
import { updateSessionOrder } from "../../lib/api";
import { mergeVisibleOrder, moveItem } from "./sessionsUtils";

type UseSessionsOrderingOptions = {
  orderedSessions: Session[];
  filteredSessions: Session[];
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  loadData: () => Promise<void>;
  push: (message: string) => void;
  t: (zh: string, en: string) => string;
  draggingRef: React.MutableRefObject<boolean>;
};

export function useSessionsOrdering({
  orderedSessions,
  filteredSessions,
  setSessions,
  loadData,
  push,
  t,
  draggingRef,
}: UseSessionsOrderingOptions) {
  const [draggingSessionId, setDraggingSessionId] = React.useState<string | null>(null);
  const [savingOrder, setSavingOrder] = React.useState(false);
  const orderDirtyRef = React.useRef(false);
  const orderedIdsRef = React.useRef<string[]>([]);
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>());
  const previousPositionsRef = React.useRef(new Map<string, DOMRect>());

  React.useEffect(() => {
    orderedIdsRef.current = orderedSessions.map((session) => session.id);
  }, [orderedSessions]);

  React.useLayoutEffect(() => {
    const nextPositions = new Map<string, DOMRect>();
    filteredSessions.forEach((session) => {
      const element = cardRefs.current.get(session.id);
      if (element) {
        nextPositions.set(session.id, element.getBoundingClientRect());
      }
    });

    const previousPositions = previousPositionsRef.current;
    nextPositions.forEach((nextRect, sessionId) => {
      const previousRect = previousPositions.get(sessionId);
      if (!previousRect) {
        return;
      }
      const deltaY = previousRect.top - nextRect.top;
      if (deltaY === 0) {
        return;
      }
      const element = cardRefs.current.get(sessionId);
      if (!element) {
        return;
      }
      element.style.transform = `translateY(${deltaY}px)`;
      element.getBoundingClientRect();
      element.style.transform = "";
    });

    previousPositionsRef.current = nextPositions;
  }, [filteredSessions]);

  const persistSessionOrder = React.useCallback(async (orderedIds: string[]) => {
    if (savingOrder) {
      return;
    }
    setSavingOrder(true);
    try {
      await updateSessionOrder(orderedIds);
      push(t("排序已保存", "Order saved"));
    } catch (error) {
      push(error instanceof Error ? error.message : t("保存失败", "Save failed"));
      await loadData();
    } finally {
      setSavingOrder(false);
    }
  }, [loadData, push, savingOrder, t]);

  const applySessionOrder = React.useCallback((orderedIds: string[]) => {
    orderedIdsRef.current = orderedIds;
    const orderMap = new Map(orderedIds.map((id, index) => [id, index + 1]));
    setSessions((prev) => prev.map((session) => (
      orderMap.has(session.id)
        ? { ...session, session_order: orderMap.get(session.id) }
        : session
    )));
  }, [setSessions]);

  const handleDragStart = React.useCallback((sessionId: string, event: React.DragEvent<HTMLButtonElement>) => {
    if (savingOrder) {
      event.preventDefault();
      return;
    }
    draggingRef.current = true;
    orderDirtyRef.current = false;
    setDraggingSessionId(sessionId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sessionId);
  }, [savingOrder]);

  const handleDragOver = React.useCallback((sessionId: string, event: React.DragEvent<HTMLDivElement>) => {
    if (!draggingSessionId || draggingSessionId === sessionId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const visibleOrderIds = filteredSessions.map((session) => session.id);
    if (!visibleOrderIds.includes(draggingSessionId) || !visibleOrderIds.includes(sessionId)) {
      return;
    }
    const fromIndex = visibleOrderIds.indexOf(draggingSessionId);
    const toIndex = visibleOrderIds.indexOf(sessionId);
    if (fromIndex === toIndex) {
      return;
    }
    const nextVisibleOrder = moveItem(visibleOrderIds, fromIndex, toIndex);
    const nextFullOrder = mergeVisibleOrder(orderedIdsRef.current, visibleOrderIds, nextVisibleOrder);
    applySessionOrder(nextFullOrder);
    orderDirtyRef.current = true;
  }, [applySessionOrder, draggingSessionId, filteredSessions]);

  const handleDragEnd = React.useCallback(async () => {
    draggingRef.current = false;
    setDraggingSessionId(null);
    if (!orderDirtyRef.current) {
      return;
    }
    orderDirtyRef.current = false;
    await persistSessionOrder(orderedIdsRef.current);
  }, [persistSessionOrder]);

  const handleMoveSession = React.useCallback(async (sessionId: string, direction: "up" | "down") => {
    if (savingOrder) {
      return;
    }
    const visibleOrderIds = filteredSessions.map((session) => session.id);
    const currentIndex = visibleOrderIds.indexOf(sessionId);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= visibleOrderIds.length) {
      return;
    }
    const nextVisibleOrder = moveItem(visibleOrderIds, currentIndex, targetIndex);
    const nextFullOrder = mergeVisibleOrder(orderedIdsRef.current, visibleOrderIds, nextVisibleOrder);
    applySessionOrder(nextFullOrder);
    await persistSessionOrder(nextFullOrder);
  }, [applySessionOrder, filteredSessions, persistSessionOrder, savingOrder]);

  return {
    draggingSessionId,
    savingOrder,
    orderedIdsRef,
    cardRefs,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleMoveSession,
  };
}
