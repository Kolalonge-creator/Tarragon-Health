import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COACH_TIERS, type CoachChatMessage, type CoachTier, type Database } from "@tarragon/shared";
import {
  COACH_SYSTEM_PROMPT,
  COACH_UNAVAILABLE_REPLY,
  DISCLAIMER_LINE,
  EMERGENCY_SAFETY_REPLY,
} from "./prompts";
import { detectEmergencyKeywords } from "./keyword-guardrail";
import { loadPatientContext } from "./context";
import { logAiCoachEscalation } from "./escalate";

const structuredReplySchema = z.object({
  tier: z.enum(COACH_TIERS),
  reply: z.string(),
});

const CoachState = Annotation.Root({
  profileId: Annotation<string>,
  organisationId: Annotation<string>,
  conversationId: Annotation<string>,
  incomingMessage: Annotation<string>,
  priorMessages: Annotation<CoachChatMessage[]>,
  tier: Annotation<CoachTier | null>({ reducer: (_prev, next) => next, default: () => null }),
  reply: Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  escalationId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
});

export type CoachGraphState = typeof CoachState.State;

export interface CoachGraphDeps {
  /** Patient's own RLS-scoped session — reads/writes ai_conversations and audit_log. */
  supabase: SupabaseClient<Database>;
  /** Staff-write-only tables (clinician_alerts, escalations) the patient's own session
   * can't insert into. Lazy — only constructed if an emergency actually needs escalating,
   * so a missing SUPABASE_SERVICE_ROLE_KEY doesn't break the routine/clinician_review paths. */
  getServiceRoleSupabase: () => SupabaseClient<Database>;
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic;
}

function buildModel(): ChatAnthropic {
  return new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
    maxTokens: 500,
    // @langchain/anthropic@0.3.x unconditionally sends temperature/top_p/
    // top_k on every request (defaulting top_p/top_k to a -1 "unset"
    // sentinel it only omits for a few hardcoded older model-name
    // substrings). The claude-sonnet-5 API rejects all three outright for
    // this model generation ("`top_p` cannot be set to -1", "`temperature`
    // is deprecated") — invocationKwargs is spread last in this package's
    // request-building code, so setting them to `undefined` here overrides
    // the class defaults and omits the keys from the request entirely.
    invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
  });
}

/** Builds the AI Coach's LangGraph turn:
 *
 *   START -> keywordGuardrail -+-> (emergency) -> escalate -> END
 *                               \-> llmTurn -+-> (emergency) -> escalate -> END
 *                                             +-> (clinician_review) -> logReview -> END
 *                                             +-> (routine) -> END
 *
 * `keywordGuardrail` is a deterministic regex pass that never calls Claude —
 * a safety net that still works if the model is unreachable. `llmTurn` only
 * runs when the keyword pass didn't already flag an emergency, and itself
 * degrades to the cautious 'clinician_review' tier (never silently
 * 'routine') on any Claude failure.
 *
 * The graph only decides what to say and whether to escalate — it does not
 * write to ai_conversations itself. Persisting the turn happens once in
 * runCoachTurn() (index.ts), against the full, untruncated message history;
 * `state.priorMessages` here is deliberately windowed (see HISTORY_LIMIT in
 * index.ts) for LLM context only, so building persistence on top of it would
 * silently drop everything older than the window on every turn.
 */
export function buildCoachGraph(deps: CoachGraphDeps) {
  function keywordGuardrail(state: CoachGraphState) {
    if (detectEmergencyKeywords(state.incomingMessage)) {
      return { tier: "emergency" as const, reply: EMERGENCY_SAFETY_REPLY };
    }
    return {};
  }

  async function llmTurn(state: CoachGraphState) {
    const context = await loadPatientContext(deps.supabase, state.profileId);
    const contextLine =
      context.elevatedConditions.length > 0
        ? `The patient currently has an elevated risk tier for: ${context.elevatedConditions.join(", ")}.`
        : "";

    const history = state.priorMessages.map((message) =>
      message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content)
    );

    try {
      // Built inside the try block, not at graph-build time — a missing/invalid
      // ANTHROPIC_API_KEY must degrade this turn, not throw before we can catch it.
      const model = deps.model ?? buildModel();
      const structuredModel = model.withStructuredOutput(structuredReplySchema);
      const result = await structuredModel.invoke([
        new SystemMessage(contextLine ? `${COACH_SYSTEM_PROMPT}\n\n${contextLine}` : COACH_SYSTEM_PROMPT),
        ...history,
        new HumanMessage(state.incomingMessage),
      ]);

      // The emergency-tier safety sentence is always the canned copy, never
      // the model's own phrasing of it — see prompts.ts.
      if (result.tier === "emergency") {
        return { tier: "emergency" as const, reply: `${result.reply}\n\n${EMERGENCY_SAFETY_REPLY}` };
      }
      return { tier: result.tier, reply: `${result.reply}\n\n${DISCLAIMER_LINE}` };
    } catch (error) {
      // Degrading to the patient is correct either way, but swallowing the
      // real cause entirely makes a bad key/model/network issue undebuggable.
      console.error("ai-coach: llmTurn failed, degrading to clinician_review", error);
      return { tier: "clinician_review" as const, reply: COACH_UNAVAILABLE_REPLY };
    }
  }

  async function escalate(state: CoachGraphState) {
    const escalationId = await logAiCoachEscalation(deps.getServiceRoleSupabase(), {
      organisationId: state.organisationId,
      patientId: state.profileId,
      conversationId: state.conversationId,
      triggerMessage: state.incomingMessage,
    });
    return { escalationId };
  }

  async function logReview(state: CoachGraphState) {
    await deps.supabase.from("audit_log").insert({
      organisation_id: state.organisationId,
      actor_id: state.profileId,
      action: "ai_coach.clinician_review_flagged",
      entity_type: "ai_conversations",
      entity_id: state.conversationId,
      event: { message: state.incomingMessage },
    });
    return {};
  }

  return new StateGraph(CoachState)
    .addNode("keywordGuardrail", keywordGuardrail)
    .addNode("llmTurn", llmTurn)
    .addNode("escalate", escalate)
    .addNode("logReview", logReview)
    .addEdge(START, "keywordGuardrail")
    .addConditionalEdges(
      "keywordGuardrail",
      (state) => (state.tier === "emergency" ? "escalate" : "llmTurn"),
      { escalate: "escalate", llmTurn: "llmTurn" }
    )
    .addConditionalEdges(
      "llmTurn",
      (state) => {
        if (state.tier === "emergency") return "escalate";
        if (state.tier === "clinician_review") return "logReview";
        return END;
      },
      { escalate: "escalate", logReview: "logReview", [END]: END }
    )
    .addEdge("escalate", END)
    .addEdge("logReview", END)
    .compile();
}
