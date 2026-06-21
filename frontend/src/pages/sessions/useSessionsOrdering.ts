import React from "react";
import type { Session } from "../../lib/api";
import { updateSessionOrder } from "../../lib/api";
import { mergeVisibleOrder, moveItem, reorderSessionsWithinConnection } from "./sessionsUtils";

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

  const getVisibleOrderIds = React.useCallback((scopeSessions?: Session[]) => {
    return (scopeSessions ?? filteredSessions).map((session) => session.id);
  }, [filteredSessions]);

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
  }, [draggingRef, savingOrder]);

  const handleDragOver = React.useCallback((
    sessionId: string,
    event: React.DragEvent<HTMLDivElement>,
    scopeSessions?: Session[]
  ) => {
    if (!draggingSessionId || draggingSessionId === sessionId) {
      return;
    }
    const visibleOrderIds = getVisibleOrderIds(scopeSessions);
    if (!visibleOrderIds.includes(draggingSessionId) || !visibleOrderIds.includes(sessionId)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const fromIndex = visibleOrderIds.indexOf(draggingSessionId);
    const toIndex = visibleOrderIds.indexOf(sessionId);
    if (fromIndex === toIndex) {
      return;
    }
    const nextVisibleOrder = moveItem(visibleOrderIds, fromIndex, toIndex);
    const targetSession = scopeSessions?.find((session) => session.id === sessionId);
    const nextFullOrder = targetSession
      ? reorderSessionsWithinConnection(orderedIdsRef.current, scopeSessions ?? [], targetSession.connection_id, draggingSessionId, sessionId)
      : mergeVisibleOrder(orderedIdsRef.current, visibleOrderIds, nextVisibleOrder);
    if (nextFullOrder === orderedIdsRef.current) {
      return;
    }
    applySessionOrder(nextFullOrder);
    orderDirtyRef.current = true;
  }, [applySessionOrder, draggingSessionId, getVisibleOrderIds]);

  const handleDragEnd = React.useCallback(async () => {
    draggingRef.current = false;
    setDraggingSessionId(null);
    if (!orderDirtyRef.current) {
      return;
    }
    orderDirtyRef.current = false;
    await persistSessionOrder(orderedIdsRef.current);
  }, [draggingRef, persistSessionOrder]);

  const handleMoveSession = React.useCallback(async (
    sessionId: string,
    direction: "up" | "down",
    scopeSessions?: Session[]
  ) => {
    if (savingOrder) {
      return;
    }
    const visibleOrderIds = getVisibleOrderIds(scopeSessions);
    const currentIndex = visibleOrderIds.indexOf(sessionId);
    if (currentIndex < 0) {
      return;
    }
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= visibleOrderIds.length) {
      return;
    }
    const nextVisibleOrder = moveItem(visibleOrderIds, currentIndex, targetIndex);
    const currentSession = scopeSessions?.find((session) => session.id === sessionId);
    const targetSessionId = visibleOrderIds[targetIndex];
    const nextFullOrder = currentSession
      ? reorderSessionsWithinConnection(orderedIdsRef.current, scopeSessions ?? [], currentSession.connection_id, sessionId, targetSessionId)
      : mergeVisibleOrder(orderedIdsRef.current, visibleOrderIds, nextVisibleOrder);
    if (nextFullOrder === orderedIdsRef.current) {
      return;
    }
    applySessionOrder(nextFullOrder);
    await persistSessionOrder(nextFullOrder);
  }, [applySessionOrder, getVisibleOrderIds, persistSessionOrder, savingOrder]);

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
