import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachChatMessage, CoachSuggestedAction, CoachTier, Database } from "@tarragon/shared";
import { buildCoachGraph, type CoachGraphDeps } from "./graph";
import { COACH_ACCESS_DENIED_REPLY, hasCoachAccess } from "./entitlement";
import { COACH_LIMIT_REACHED_REPLY, countMessagesToday, getCoachDailyLimit } from "./rate-limit";
import { detectEmergencyKeywords } from "./keyword-guardrail";
import { COACH_UNAVAILABLE_REPLY, EMERGENCY_SAFETY_REPLY, COACH_PROMPT_VERSION } from "./prompts";
import { logAiCoachEscalation } from "./escalate";
import { AI_SYSTEMS, governedSystemPrompt, runGovernedAi } from "@/lib/ai-governance";
import { logAssistantTurn } from "./audit";
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
  /**
   * The ai_interaction_log row this turn produced (Module 40.11), or null if
   * the audit write itself failed. Surfaced so the chat UI can attach a
   * patient's "this was wrong" report (40.12) to the exact turn they mean.
   */
  aiInteractionId: string | null;
}

/** What the coach turn resolved to, before it is persisted to the thread. */
interface CoachTurnOutcome {
  readonly tier: CoachTier;
  readonly reply: string;
  readonly escalationId: string | null;
  /** Present only on paths that actually reached graph.invoke() — absent on
   * the kill-switch fallback path, which never ran the graph at all. Carried
   * through governed.value (rather than closing over the graph's own
   * `result`, which is only in scope inside the run() callback) so the
   * ai_assistant_turns provenance write after runGovernedAi() returns has
   * something to log regardless of which of run()/fallback() produced this
   * outcome. */
  readonly modelId?: string | null;
  readonly retrievedSourceIds?: string[];
  /** §78.18 auditability -- human-readable titles of any retrieved content
   * that fed this reply, for the persisted assistant message. See
   * graph.ts's CoachState doc comment for why this is separate from
   * retrievedSourceIds. */
  readonly knowledgeSourceUsed?: string[];
  /** §78.2 in-chat suggestion the model classified for this reply, or
   * "none"/absent on the kill-switch fallback path. */
  readonly suggestedAction?: CoachSuggestedAction;
  readonly clinicianAlertId?: string | null;
  readonly referralRequestClinicianAlertId?: string | null;
  readonly careMessageThreadId?: string | null;
  readonly referralRequestCareMessageThreadId?: string | null;
  readonly degraded?: boolean;
  readonly errorMessage?: string | null;
  readonly inputSnapshotForAudit?: Record<string, unknown>;
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
    return { conversationId, reply: COACH_ACCESS_DENIED_REPLY, tier: "routine", aiInteractionId: null };
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
    return { conversationId, reply: COACH_LIMIT_REACHED_REPLY, tier: "routine", aiInteractionId: null };
  }

  // Neither of the two short-circuits above is recorded in ai_interaction_log,
  // deliberately: no model was reached and no governed decision was made, so
  // logging them would turn the AI audit trail into a general activity log and
  // make its escalation/override rates meaningless. Governance starts here,
  // at the point an AI call would actually happen.

  // The keyword pass is deterministic and cheap, and it is the one part of
  // the coach that must work whether or not the model does. Running it here
  // as well as inside the graph is what lets the governance fallback below
  // keep the emergency safety net when AI-001 is switched off — and it is
  // what tells the audit trail which guardrail fired.
  const keywordEmergency = detectEmergencyKeywords(message);
  const threadId = conversationId;

  const governed = await runGovernedAi<CoachTurnOutcome>({
    supabase,
    systemCode: AI_SYSTEMS.coach.code,
    inputCategory: "patient_coach_message",
    subjectProfileId: profileId,

    run: async ({ config }) => {
      const graph = buildCoachGraph({
        supabase,
        getServiceRoleSupabase,
        model: params.model,
        systemPrompt: governedSystemPrompt(config) ?? undefined,
      });
      const result = await graph.invoke({
        profileId,
        organisationId,
        conversationId: threadId,
        incomingMessage: message,
        priorMessages: fullMessages.slice(-CONTEXT_HISTORY_LIMIT),
      });

      const tier: CoachTier = result.tier ?? "routine";
      return {
        value: {
          tier,
          reply: result.reply,
          escalationId: result.escalationId ?? null,
          modelId: result.modelId,
          retrievedSourceIds: result.retrievedSourceIds,
          knowledgeSourceUsed: result.knowledgeSourceUsed,
          suggestedAction: result.suggestedAction,
          clinicianAlertId: result.clinicianAlertId,
          referralRequestClinicianAlertId: result.referralRequestClinicianAlertId,
          careMessageThreadId: result.careMessageThreadId,
          referralRequestCareMessageThreadId: result.referralRequestCareMessageThreadId,
          degraded: result.degraded,
          errorMessage: result.errorMessage,
          inputSnapshotForAudit: result.inputSnapshotForAudit,
        },
        // What actually answered. Mirrors buildAnthropicModel()'s own default
        // so a drifting ANTHROPIC_MODEL shows up in
        // ai_vendor_model_observations rather than passing unnoticed (40.19).
        modelIdentifier: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
        outputSummary: result.reply,
        safetyClassification: tier,
        guardrailsTriggered: keywordEmergency ? ["emergency_keyword_escalation"] : [],
        // A keyword-matched emergency never reaches the model at all: the
        // canned safety reply is substituted for whatever it would have said.
        // That is a guardrail suppressing output, which the audit trail
        // records as `blocked`, not `completed`.
        blockedByGuardrail: keywordEmergency,
        resultingAction: result.escalationId
          ? "clinician_alert_raised"
          : tier === "clinician_review"
            ? "clinician_review_flagged"
            : "none",
        resultingEntityType: result.escalationId ? "clinician_alerts" : null,
        resultingEntityId: result.escalationId ?? null,
      };
    },

    // 40.18 in full. With the coach switched off, the emergency safety net is
    // the thing that must survive — the escalation and the hand-written
    // emergency copy both still happen, because neither ever needed the model.
    // Everything else degrades to "I can't reach the coach, here is who to
    // contact", which is the fallback_behaviour recorded for AI-001.
    fallback: async () => {
      if (!keywordEmergency) {
        // Tiered routine, not clinician_review: a deliberate switch-off is not
        // a clinical signal about this patient, and tiering every message
        // during an outage would bury the worklist in noise.
        return { tier: "routine", reply: COACH_UNAVAILABLE_REPLY, escalationId: null };
      }

      let escalationId: string | null = null;
      try {
        const escalation = await logAiCoachEscalation(supabase, getServiceRoleSupabase(), {
          organisationId,
          patientId: profileId,
          conversationId: threadId,
          triggerMessage: message,
          // The graph never ran on this path (AI-001 is switched off), so
          // there's no turn history to draw a handoff summary from -- an
          // empty array short-circuits buildCoachHandoffSummary to its
          // template fallback (see handoff-summary.ts).
          recentMessages: [],
          aiAction: "Escalated immediately via deterministic safety-keyword match while the AI Coach was switched off",
        });
        escalationId = escalation.escalationId;
      } catch (error) {
        // The patient still gets the emergency copy. Losing the alert is bad;
        // withholding "go to the nearest hospital" because a write failed
        // would be far worse.
        console.error("ai-coach: emergency escalation failed on the fallback path", error);
      }
      return { tier: "emergency", reply: EMERGENCY_SAFETY_REPLY, escalationId };
    },
  });

  const { tier, reply } = governed.value;
  const now = new Date().toISOString();
  const userMessage: CoachChatMessage = { id: crypto.randomUUID(), role: "user", content: message, created_at: now };
  const assistantMessage: CoachChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: reply,
    tier,
    suggestedAction:
      governed.value.suggestedAction && governed.value.suggestedAction !== "none"
        ? governed.value.suggestedAction
        : undefined,
    // Absent (not a real model call) for a keyword-guardrail-only emergency
    // reply, or for the kill-switch fallback path — see CoachState's
    // modelId doc comment. §78.18 auditability.
    model: governed.value.modelId ?? undefined,
    knowledgeSourceUsed:
      governed.value.knowledgeSourceUsed && governed.value.knowledgeSourceUsed.length > 0
        ? governed.value.knowledgeSourceUsed
        : undefined,
    created_at: now,
  };
  await appendMessages(supabase, conversationId, fullMessages, [userMessage, assistantMessage]);

  // A referral request (referral-tool.ts) can create a real clinician_alerts
  // row on ANY tier, including 'routine' — so finalAction reflects that even
  // when the tier-driven classification alone would have said 'replied'.
  // governed.value.clinicianAlertId (the tier-driven escalation/review alert)
  // and governed.value.referralRequestClinicianAlertId (the referral-tool
  // alert) are both, in principle, independently settable in the same turn —
  // the audit row's single clinician_alert_id column prefers the tier-driven
  // one when both exist; the referral one is always recorded in
  // input_snapshot too. On the kill-switch fallback path (no graph run at
  // all) governed.value carries none of these extra fields, so this block
  // degrades to a plain "replied"/"escalation_created" classification with
  // no model/retrieval detail — there is nothing more to log.
  const finalAction: "replied" | "clinician_alert_created" | "escalation_created" =
    tier === "emergency"
      ? "escalation_created"
      : tier === "clinician_review" || governed.value.referralRequestClinicianAlertId
        ? "clinician_alert_created"
        : "replied";

  await logAssistantTurn(getServiceRoleSupabase(), {
    organisationId,
    patientId: profileId,
    conversationId,
    interactionType: "chat_turn",
    modelId: governed.value.modelId,
    promptVersion: governed.value.modelId ? COACH_PROMPT_VERSION : null,
    safetyClassification: tier,
    retrievedSourceIds: governed.value.retrievedSourceIds,
    clinicianAlertId: governed.value.clinicianAlertId ?? governed.value.referralRequestClinicianAlertId,
    escalationId: governed.value.escalationId,
    finalAction,
    status: governed.value.degraded ? "degraded" : "completed",
    errorMessage: governed.value.errorMessage,
    inputSnapshot: {
      ...governed.value.inputSnapshotForAudit,
      careMessageThreadId: governed.value.careMessageThreadId,
      referralRequestCareMessageThreadId: governed.value.referralRequestCareMessageThreadId,
    },
  });

  return { conversationId, reply, tier, aiInteractionId: governed.interactionId };
}
