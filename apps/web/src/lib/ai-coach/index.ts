import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachChatMessage, CoachTier, Database } from "@tarragon/shared";
import { buildCoachGraph, type CoachGraphDeps } from "./graph";
import { COACH_ACCESS_DENIED_REPLY, hasCoachAccess } from "./entitlement";
import { COACH_LIMIT_REACHED_REPLY, countMessagesToday, getCoachDailyLimit } from "./rate-limit";
import { logAssistantTurn } from "./audit";
import { COACH_PROMPT_VERSION } from "./prompts";
import { appendMessages, resolveOrCreateConversation } from "./conversation-store";

export interface RunCoachTurnParams {
  supabase: SupabaseClient<Database>;
  getServiceRoleSupabase: () => SupabaseClient<Database>;
  profileId: string;
  organisationId: string;
  /** Omit to start a new conversation thread. */
  conversationId?: string;
  message: string;
  model?: CoachGraphDeps["model"];
}

export interface RunCoachTurnResult {
  conversationId: string;
  reply: string;
  tier: CoachTier;
}

/** Cap on how much history is sent to Claude for context — not a cap on
 * what's persisted. Keeping these separate matters: an earlier version of
 * this function reused the windowed slice as the base for saving, which
 * silently dropped everything older than the window on every single turn. */
const CONTEXT_HISTORY_LIMIT = 20;

/** Transport-agnostic AI Coach turn — takes a profile + message, runs the
 * LangGraph flow, and returns the reply. Callable from a server action
 * today; the same function is what a future WhatsApp webhook route would
 * call too, so it doesn't assume anything about how it was invoked.
 *
 * Every return path also writes one ai_assistant_turns audit row
 * (audit.ts) — the §36.17 provenance record docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md
 * §4.3 identified as missing, including on the two short-circuit paths
 * (access denied, rate limited) that never reach the graph at all. The
 * audit write is best-effort (logAssistantTurn never throws) — a failed
 * audit write must never be the reason a patient-facing turn breaks.
 */
export async function runCoachTurn(params: RunCoachTurnParams): Promise<RunCoachTurnResult> {
  const { supabase, getServiceRoleSupabase, profileId, organisationId, message } = params;

  const { conversationId, fullMessages } = await resolveOrCreateConversation(
    supabase,
    organisationId,
    profileId,
    params.conversationId
  );

  // Defense in depth: care/page.tsx and lifestyle/page.tsx only render the
  // chat UI when hasCoachAccess() is true, but neither of them re-checks it
  // on every send, and this function is meant to be transport-agnostic (see
  // its docstring) — a future caller with no UI gate at all would otherwise
  // skip this check entirely. Same short-circuit shape as the daily-limit
  // block below: append a canned reply, return normally, no thrown error.
  const hasAccess = await hasCoachAccess(supabase);
  if (!hasAccess) {
    const now = new Date().toISOString();
    const userMessage: CoachChatMessage = { id: crypto.randomUUID(), role: "user", content: message, created_at: now };
    const assistantMessage: CoachChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: COACH_ACCESS_DENIED_REPLY,
      tier: "routine",
      created_at: now,
    };
    await appendMessages(supabase, conversationId, fullMessages, [userMessage, assistantMessage]);
    await logAssistantTurn(getServiceRoleSupabase(), {
      organisationId,
      patientId: profileId,
      conversationId,
      interactionType: "chat_turn",
      finalAction: "declined",
      status: "access_denied",
    });
    return { conversationId, reply: COACH_ACCESS_DENIED_REPLY, tier: "routine" };
  }

  const [messagesToday, dailyLimit] = await Promise.all([
    countMessagesToday(supabase, profileId),
    getCoachDailyLimit(supabase),
  ]);
  if (messagesToday >= dailyLimit) {
    // Skip the graph entirely — the whole point is to avoid the Claude call,
    // not just decline to show its result.
    const now = new Date().toISOString();
    const userMessage: CoachChatMessage = { id: crypto.randomUUID(), role: "user", content: message, created_at: now };
    const assistantMessage: CoachChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: COACH_LIMIT_REACHED_REPLY,
      tier: "routine",
      created_at: now,
    };
    await appendMessages(supabase, conversationId, fullMessages, [userMessage, assistantMessage]);
    await logAssistantTurn(getServiceRoleSupabase(), {
      organisationId,
      patientId: profileId,
      conversationId,
      interactionType: "chat_turn",
      finalAction: "declined",
      status: "rate_limited",
    });
    return { conversationId, reply: COACH_LIMIT_REACHED_REPLY, tier: "routine" };
  }

  const graph = buildCoachGraph({ supabase, getServiceRoleSupabase, model: params.model });
  const result = await graph.invoke({
    profileId,
    organisationId,
    conversationId,
    incomingMessage: message,
    priorMessages: fullMessages.slice(-CONTEXT_HISTORY_LIMIT),
  });

  const tier = result.tier ?? "routine";
  const now = new Date().toISOString();
  const userMessage: CoachChatMessage = { id: crypto.randomUUID(), role: "user", content: message, created_at: now };
  const assistantMessage: CoachChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: result.reply,
    tier,
    created_at: now,
  };
  await appendMessages(supabase, conversationId, fullMessages, [userMessage, assistantMessage]);

  // A referral request (referral-tool.ts) can create a real clinician_alerts
  // row on ANY tier, including 'routine' — so finalAction reflects that even
  // when the tier-driven classification alone would have said 'replied'.
  // result.clinicianAlertId (the tier-driven escalation/review alert) and
  // result.referralRequestClinicianAlertId (the referral-tool alert) are
  // both, in principle, independently settable in the same turn — the audit
  // row's single clinician_alert_id column prefers the tier-driven one when
  // both exist; the referral one is always recorded in input_snapshot too.
  const finalAction: "replied" | "clinician_alert_created" | "escalation_created" =
    tier === "emergency"
      ? "escalation_created"
      : tier === "clinician_review" || result.referralRequestClinicianAlertId
        ? "clinician_alert_created"
        : "replied";

  await logAssistantTurn(getServiceRoleSupabase(), {
    organisationId,
    patientId: profileId,
    conversationId,
    interactionType: "chat_turn",
    modelId: result.modelId,
    promptVersion: result.modelId ? COACH_PROMPT_VERSION : null,
    safetyClassification: tier,
    retrievedSourceIds: result.retrievedSourceIds,
    clinicianAlertId: result.clinicianAlertId ?? result.referralRequestClinicianAlertId,
    escalationId: result.escalationId,
    finalAction,
    status: result.degraded ? "degraded" : "completed",
    errorMessage: result.errorMessage,
    inputSnapshot: {
      ...result.inputSnapshotForAudit,
      careMessageThreadId: result.careMessageThreadId,
      referralRequestCareMessageThreadId: result.referralRequestCareMessageThreadId,
    },
  });

  return { conversationId, reply: result.reply, tier };
}
