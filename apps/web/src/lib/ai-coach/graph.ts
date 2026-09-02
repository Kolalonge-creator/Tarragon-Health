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
  SYMPTOM_SUGGESTION_INTRO,
} from "./prompts";
import { detectEmergencyKeywords } from "./keyword-guardrail";
import { matchSymptomClustersFromText } from "@/lib/symptom-check/symptom-clusters";
import { loadPatientContext } from "./context";
import { logAiCoachEscalation, logAiCoachReviewFlag } from "./escalate";
import { buildAnthropicModel } from "./model";
import type { Embedder } from "@/lib/lifestyle/embed-content";
import { createVoyageEmbedderFromEnv } from "@/lib/lifestyle/voyage-embedder";
import { findRelevantLifestyleContent } from "@/lib/lifestyle/find-relevant-content";

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
  /** Injectable for tests; defaults to a real Voyage AI client built from
   * VOYAGE_API_KEY (voyage-embedder.ts). `null` (the default when unset)
   * means "no embedder configured" — content retrieval is skipped
   * gracefully, same no-op contract as populateContentEmbeddings. */
  embedder?: Embedder | null;
}

/**
 * Appends a fixed, clinician-authored test suggestion to an already-decided
 * non-emergency reply, if `incomingMessage` matches one of the curated
 * clusters in lib/symptom-check/symptom-clusters.ts. The LLM never decides
 * this — a deterministic regex match against clinician-authored data does,
 * same principle as EMERGENCY_SAFETY_REPLY being appended rather than
 * generated. Callers must only invoke this once a message is already
 * confirmed non-emergency (both by keywordGuardrail and by the LLM's own
 * tier), since this function does no emergency classification of its own.
 */
export function appendSymptomSuggestion(reply: string, incomingMessage: string): string {
  const clusters = matchSymptomClustersFromText(incomingMessage);
  if (clusters.length === 0) return reply;
  const suggestions = clusters
    .map(
      (cluster) =>
        `${cluster.name}: ${cluster.patientExplanation} You can request this test in the app, or book a doctor's consultation first if you'd rather talk it through before testing.`
    )
    .join("\n\n");
  return `${reply}\n\n${SYMPTOM_SUGGESTION_INTRO}\n\n${suggestions}`;
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
    const contextLines: string[] = [];
    if (context.elevatedConditions.length > 0) {
      contextLines.push(
        `The patient currently has an elevated risk tier for: ${context.elevatedConditions.join(", ")}.`
      );
    }
    // Per-programme grounding. A paused/flagged programme gets a deference
    // instruction instead of goal talk — mirrors, at the prompt level, the
    // same hard rule @tarragon/lifestyle-engine's applyGuardrails() enforces
    // in code (never push weight-loss/programme content at a paused or
    // flagged enrolment). The deterministic keyword guardrail and the
    // tier-classification instructions above remain the real enforcement
    // backstops regardless of what's injected here.
    for (const p of context.lifestyleProgrammes) {
      if (p.status === "paused" || p.hasOpenRedFlag) {
        contextLines.push(
          `The patient's ${p.conditionLabel} lifestyle programme is currently paused or flagged ` +
            `for a doctor's review. Do not encourage progress toward its goals or suggest pushing ` +
            `forward — acknowledge it supportively and point them to their care team if they bring it up.`
        );
      } else {
        const goalsPart =
          p.goalTitles.length > 0 ? ` Current goals: ${p.goalTitles.join(", ")}.` : "";
        contextLines.push(
          `The patient is enrolled in a ${p.conditionLabel} lifestyle programme` +
            (p.currentPhaseName ? `, currently in the "${p.currentPhaseName}" phase.` : ".") +
            goalsPart
        );
      }
    }

    // Reference-material retrieval (find-relevant-content.ts), scoped to the
    // patient's own active (non-paused, non-flagged) lifestyle programme —
    // paused/flagged programmes already got a deference instruction above
    // and shouldn't also be handed goal-adjacent reading material. Never
    // throws; this whole block is a no-op today (no VOYAGE_API_KEY
    // configured, and no lpe_content_blocks row is clinician_reviewed yet —
    // see the 58-block draft library) and starts surfacing content
    // automatically the moment both exist, no further code change needed.
    const activeProgramme = context.lifestyleProgrammes.find(
      (p) => p.status !== "paused" && !p.hasOpenRedFlag
    );
    if (activeProgramme) {
      const embedder = deps.embedder ?? createVoyageEmbedderFromEnv();
      if (embedder) {
        const relevant = await findRelevantLifestyleContent(
          deps.supabase,
          embedder,
          state.incomingMessage,
          { matchCount: 2, conditionFilter: activeProgramme.condition }
        );
        if (relevant.length > 0) {
          contextLines.push(
            "Clinician-approved reference material that may be relevant to this message " +
              "(use it to inform your answer in your own words and voice, don't quote it at " +
              "length or present it as a document):\n" +
              relevant.map((r) => `- ${r.title}: ${r.bodyMd}`).join("\n")
          );
        }
      }
    }

    const contextLine = contextLines.join("\n\n");

    const history = state.priorMessages.map((message) =>
      message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content)
    );

    try {
      // Built inside the try block, not at graph-build time — a missing/invalid
      // ANTHROPIC_API_KEY must degrade this turn, not throw before we can catch it.
      const model = deps.model ?? buildAnthropicModel({ maxTokens: 500 });
      const structuredModel = model.withStructuredOutput(structuredReplySchema);
      // cache_control on the newest turn (not the system message) is the
      // "multi-turn conversation" caching pattern: it marks system + all prior
      // history + this message as one cached prefix, so next turn's request
      // re-reads everything up to here instead of re-billing it, and only
      // pays full price for whatever's new. The system message + a single
      // turn or two often sits under Sonnet 5's 1024-token cacheable-prefix
      // minimum (a marker below it is a documented no-op, not an error), so
      // this mostly starts paying off from the 3rd exchange in a session
      // onward — but it costs nothing on the turns where it doesn't.
      const result = await structuredModel.invoke([
        new SystemMessage(contextLine ? `${COACH_SYSTEM_PROMPT}\n\n${contextLine}` : COACH_SYSTEM_PROMPT),
        ...history,
        new HumanMessage({
          content: [
            { type: "text", text: state.incomingMessage, cache_control: { type: "ephemeral" } },
          ],
        }),
      ]);

      // The emergency-tier safety sentence is always the canned copy, never
      // the model's own phrasing of it — see prompts.ts.
      if (result.tier === "emergency") {
        return { tier: "emergency" as const, reply: `${result.reply}\n\n${EMERGENCY_SAFETY_REPLY}` };
      }
      return { tier: result.tier, reply: appendSymptomSuggestion(`${result.reply}\n\n${DISCLAIMER_LINE}`, state.incomingMessage) };
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
    // Previously audit_log only — correct for the record, but nobody's
    // dashboard reads audit_log, so a real concern could sit unseen
    // indefinitely (see logAiCoachReviewFlag's docstring). Now also opens a
    // real clinician_alerts row so a flagged-but-non-emergency turn actually
    // reaches a worklist, not just a log.
    await logAiCoachReviewFlag(deps.getServiceRoleSupabase(), {
      organisationId: state.organisationId,
      patientId: state.profileId,
      conversationId: state.conversationId,
      triggerMessage: state.incomingMessage,
    });
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
