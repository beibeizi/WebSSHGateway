import React from "react";
import { useIsMobile } from "../lib/hooks/useIsMobile";
import { SessionsDesktop } from "./sessions/SessionsDesktop";
import { SessionsMobile } from "./sessions/SessionsMobile";
import { useSessionsState } from "./sessions/useSessionsState";

export function Sessions() {
  const state = useSessionsState();
  const isMobile = useIsMobile();
  return isMobile ? <SessionsMobile state={state} /> : <SessionsDesktop state={state} />;
}
