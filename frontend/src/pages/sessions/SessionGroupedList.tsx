import React from "react";
import { cn } from "../../lib/utils";
import { buildSessionGroups } from "./sessionsUtils";
import { SessionCard } from "./SessionCard";
import { SessionEmptyState } from "./SessionEmptyState";
import { SessionGroupHeader } from "./SessionGroupHeader";
import type { SessionsState } from "./useSessionsState";

type SessionGroupedListProps = {
  state: SessionsState;
  layout: "desktop" | "mobile";
};

export function SessionGroupedList({ state, layout }: SessionGroupedListProps) {
  const [expandedGroups, setExpandedGroups] = React.useState<Record<number, boolean>>({});
  const groups = React.useMemo(
    () => buildSessionGroups(state.filteredSessions, state.connections),
    [state.connections, state.filteredSessions]
  );

  React.useEffect(() => {
    setExpandedGroups((prev) => {
      const visibleIds = new Set(groups.map((group) => group.connectionId));
      const next: Record<number, boolean> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const connectionId = Number(key);
        if (visibleIds.has(connectionId)) {
          next[connectionId] = value;
        }
      });
      return next;
    });
  }, [groups]);

  if (groups.length === 0) {
    return <SessionEmptyState state={state} />;
  }

  return (
    <div className="grid gap-4">
      {groups.map((group) => {
        const expanded = expandedGroups[group.connectionId] ?? false;
        return (
          <section
            key={group.connectionId}
            className={cn(
              "overflow-hidden rounded-lg border",
              state.isDark ? "border-slate-700 bg-slate-900/45" : "border-slate-200 bg-white"
            )}
          >
            <SessionGroupHeader
              state={state}
              group={group}
              expanded={expanded}
              onToggle={() => {
                setExpandedGroups((prev) => ({
                  ...prev,
                  [group.connectionId]: !(prev[group.connectionId] ?? false),
                }));
              }}
            />
            {expanded ? (
              <div className={`border-t p-3 sm:p-4 ${state.isDark ? "border-slate-700 bg-slate-950/15" : "border-slate-200 bg-slate-50/50"}`}>
                <div className={layout === "mobile" ? "grid gap-4" : "grid gap-4"}>
                  {group.sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      state={state}
                      session={session}
                      layout={layout}
                      orderingScopeSessions={group.sessions}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
