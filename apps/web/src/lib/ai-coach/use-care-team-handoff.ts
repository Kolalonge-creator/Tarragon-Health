"use client";

import { useState } from "react";
import { requestCareTeamHandoffAction } from "./handoff-actions";

export type CareTeamHandoffState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done" }
  | { status: "error"; error: string };

/**
 * §78.12 "I want to speak to someone" -- the state machine + call to
 * requestCareTeamHandoffAction, shared by every surface that offers this
 * control (ai-coach-chat.tsx, ask-tarragon-card.tsx) so it can't drift
 * between them again. It already had once: ask-tarragon-card.tsx's own
 * hand-copied version of this dropped the "message your care team directly"
 * fallback link the error state below carries -- caught by /code-review high
 * on PR #767. Pair with <CareTeamHandoffStatus> for the shared status copy;
 * each caller still renders its own "idle" button however its own layout
 * needs it, driven by requestHandoff and handoff.status === "idle".
 */
export function useCareTeamHandoff(conversationId: string | undefined) {
  const [handoff, setHandoff] = useState<CareTeamHandoffState>({ status: "idle" });

  async function requestHandoff() {
    setHandoff({ status: "pending" });
    const result = await requestCareTeamHandoffAction(conversationId);
    setHandoff(result.success ? { status: "done" } : { status: "error", error: result.error });
  }

  return { handoff, requestHandoff };
}
