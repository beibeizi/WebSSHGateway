import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import type { Session } from "../../lib/api";
import { cn } from "../../lib/utils";
import { SessionStatusChip } from "./SessionStatusChip";
import { SessionStatusSummary } from "./SessionStatusSummary";
import type { SessionsState } from "./useSessionsState";

type SessionCardProps = {
  state: SessionsState;
  session: Session;
  layout: "desktop" | "mobile";
  orderingScopeSessions?: Session[];
  showStatusSummary?: boolean;
};

export function SessionCard({ state, session, layout, orderingScopeSessions, showStatusSummary = true }: SessionCardProps) {
  const noteValue = state.noteDrafts[session.id] ?? "";
  const scopedSessions = orderingScopeSessions ?? state.filteredSessions;
  const currentIndex = scopedSessions.findIndex((item) => item.id === session.id);
  const canMoveUp = currentIndex > 0 && !state.ordering.savingOrder;
  const canMoveDown = currentIndex >= 0 && currentIndex < scopedSessions.length - 1 && !state.ordering.savingOrder;
  const isMobile = layout === "mobile";
  const shouldShowStatusSummary = showStatusSummary && state.showSessionStatusSummary && session.status === "active";

  const actionButtonClassName = isMobile ? "min-h-11 w-full" : undefined;
  const rootClassName = cn(
    "relative rounded-lg border p-4 transition-transform duration-200 ease-out will-change-transform",
    isMobile ? "pl-12" : "pl-14",
    state.ordering.draggingSessionId === session.id ? "ring-2 ring-indigo-400/60" : "",
    state.isDark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white shadow-sm"
  );

  const sessionMeta = (
    <div className={isMobile ? "space-y-1" : "min-w-0 space-y-1"}>
      <p className={cn("break-words font-semibold", isMobile ? "text-base" : "text-lg")}>{session.name}</p>
      <p className={`break-all text-sm ${state.isDark ? "text-slate-400" : "text-slate-500"}`}>
        {session.username}@{session.host}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SessionStatusChip
          status={session.status}
          label={state.mapSessionStatus(session.status)}
          isDark={state.isDark}
        />
      </div>
      {session.enhanced_enabled ? (
        <p className={`text-xs font-medium ${state.isDark ? "text-indigo-300" : "text-indigo-600"}`}>
          {state.t("增强持久化连接", "Enhanced persistent connection")}
        </p>
      ) : null}
      <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
        {state.t("创建时间", "Created at")}: {new Date(session.started_at).toLocaleString()}
      </p>
      <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
        {state.t("最近活动", "Last activity")}: {new Date(session.last_activity).toLocaleString()}
      </p>
      {session.disconnected_at ? (
        <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
          {state.t("断开时间", "Disconnected at")}: {new Date(session.disconnected_at).toLocaleString()}
        </p>
      ) : null}
      {session.enhanced_enabled && session.status !== "active" && session.allow_auto_retry !== false ? (
        <p className={`text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
          {state.t("本轮重试", "Retry cycle")}: {session.retry_cycle_count ?? 0}/{state.enhancedRetryMaxAttempts}
        </p>
      ) : null}
    </div>
  );

  const sessionActions = (
    <div className={isMobile ? "flex flex-col gap-2" : "flex shrink-0 flex-wrap justify-end gap-2"}>
      {session.status === "active" ? (
        <Button
          variant="secondary"
          lightMode={!state.isDark}
          className={actionButtonClassName}
          onClick={() => window.open(`/terminal/${session.id}`, "_blank")}
        >
          {state.t("打开会话", "Open session")}
        </Button>
      ) : null}
      {session.enhanced_enabled && session.status !== "active" && session.allow_auto_retry !== false ? (
        <Button
          variant="secondary"
          lightMode={!state.isDark}
          loading={state.isSystemRetrying(session) || !!state.retryingSessionIds[session.id]}
          className={actionButtonClassName}
          onClick={() => state.handleRetryEnhancedSession(session.id)}
        >
          {state.t("重试连接", "Retry")}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        lightMode={!state.isDark}
        className={actionButtonClassName}
        onClick={() => state.handleDisconnectOrDelete(session)}
      >
        {session.status === "active" ? state.t("断开", "Disconnect") : state.t("删除", "Delete")}
      </Button>
    </div>
  );

  return (
    <div
      ref={(element) => {
        if (element) {
          state.ordering.cardRefs.current.set(session.id, element);
        } else {
          state.ordering.cardRefs.current.delete(session.id);
        }
      }}
      onDragOver={
        isMobile
          ? undefined
          : (event) => state.ordering.handleDragOver(session.id, event, orderingScopeSessions)
      }
      onDrop={isMobile ? undefined : (event) => event.preventDefault()}
      className={rootClassName}
    >
      {isMobile ? (
        <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className={`flex flex-col items-center gap-1 rounded-full border p-1 ${state.isDark ? "border-slate-700 bg-slate-900 text-slate-400" : "border-slate-200 bg-white text-slate-500"}`}>
            <button
              type="button"
              onClick={() => state.ordering.handleMoveSession(session.id, "up", orderingScopeSessions)}
              disabled={!canMoveUp}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                canMoveUp
                  ? (state.isDark ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100")
                  : "cursor-not-allowed opacity-40"
              }`}
              aria-label={state.t("上移会话", "Move session up")}
            >
              <ChevronUp className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => state.ordering.handleMoveSession(session.id, "down", orderingScopeSessions)}
              disabled={!canMoveDown}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                canMoveDown
                  ? (state.isDark ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100")
                  : "cursor-not-allowed opacity-40"
              }`}
              aria-label={state.t("下移会话", "Move session down")}
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          draggable={!state.ordering.savingOrder}
          onDragStart={(event) => state.ordering.handleDragStart(session.id, event)}
          onDragEnd={state.ordering.handleDragEnd}
          disabled={state.ordering.savingOrder}
          aria-label={state.t("拖动调整排序", "Drag to reorder")}
          title={state.t("拖动调整排序", "Drag to reorder")}
          className={`absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border p-2 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            state.isDark
              ? "border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200"
              : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
          } ${state.ordering.savingOrder ? "cursor-not-allowed opacity-50" : "cursor-grab active:cursor-grabbing"}`}
        >
          <span className="flex flex-col items-center leading-none">
            <ChevronUp className="-mb-1 h-4 w-4" />
            <ChevronDown className="-mt-1 h-4 w-4" />
          </span>
        </button>
      )}

      {isMobile ? (
        <div className="space-y-2">
          <div className="min-w-0">{sessionMeta}</div>
          {sessionActions}
          {shouldShowStatusSummary ? (
            <SessionStatusSummary
              entry={state.sessionStatusEntries[session.id]}
              isDark={state.isDark}
              t={state.t}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-4">
          {sessionMeta}
          {sessionActions}
        </div>
      )}

      {!isMobile && shouldShowStatusSummary ? (
        <div className="mt-4">
          <SessionStatusSummary
            entry={state.sessionStatusEntries[session.id]}
            isDark={state.isDark}
            t={state.t}
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        <Input
          placeholder={state.t("备注", "Note")}
          value={noteValue}
          maxLength={1000}
          onChange={(event) => state.handleNoteChange(session.id, event.target.value)}
          className={!state.isDark ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400" : ""}
        />
        <div className={`flex flex-wrap items-center justify-between gap-2 text-xs ${state.isDark ? "text-slate-500" : "text-slate-400"}`}>
          <span>{state.t("最多 1000 字", "Up to 1000 characters")}</span>
          {noteValue.trim() !== (session.note ?? "") ? (
            <Button
              variant="secondary"
              lightMode={!state.isDark}
              onClick={() => state.handleSaveNote(session)}
              className={isMobile ? "min-h-11 px-3 py-2 text-xs" : undefined}
            >
              {state.t("保存备注", "Save note")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
