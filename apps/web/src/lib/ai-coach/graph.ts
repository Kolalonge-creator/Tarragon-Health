import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
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
import { logAiCoachEscalation, logAiCoachReviewFlag } from "./escalate";
import { buildAnthropicModel, getConfiguredModelId } from "./model";
import { buildPatientRecordTools } from "./tools";
import type { Embedder } from "@/lib/lifestyle/embed-content";
import { createVoyageEmbedderFromEnv } from "@/lib/lifestyle/voyage-embedder";
import { findRelevantLifestyleContent } from "@/lib/lifestyle/find-relevant-content";
import { findRelevantHealthEducationContent } from "./knowledge-base";

const structuredReplySchema = z.object({
  tier: z.enum(COACH_TIERS),
  reply: z.string(),
});

/** Hard cap on tool-calling round trips within a single turn — see llmTurn's
 * tool loop below. Bounds latency/cost and guarantees the loop always
 * terminates and reaches the final structured classify+reply call, even if
 * the model kept requesting more tools. */
const MAX_TOOL_ITERATIONS = 4;

const CoachState = Annotation.Root({
  profileId: Annotation<string>,
  organisationId: Annotation<string>,
  conversationId: Annotation<string>,
  incomingMessage: Annotation<string>,
  priorMessages: Annotation<CoachChatMessage[]>,
  tier: Annotation<CoachTier | null>({ reducer: (_prev, next) => next, default: () => null }),
  reply: Annotation<string>({ reducer: (_prev, next) => next, default: () => "" }),
  /** The model id actually used for this turn's classify+reply call — null
   * if the turn never reached a model call (keyword-guardrail-only). Feeds
   * ai_assistant_turns.model_id (audit.ts), via index.ts. */
  modelId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  /** Approved-content ids (lpe_content_blocks + health_education_content)
   * the retrieval stage actually surfaced for this turn — feeds
   * ai_assistant_turns.retrieved_source_ids. */
  retrievedSourceIds: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  /** Names of the read-only record tools (tools.ts) the model actually
   * called this turn, for the audit row's input_snapshot — not the same
   * thing as retrievedSourceIds (approved *content*, not record lookups). */
  toolsCalled: Annotation<string[]>({ reducer: (_prev, next) => next, default: () => [] }),
  /** True only when llmTurn's own try/catch caught a model failure and
   * degraded to COACH_UNAVAILABLE_REPLY — distinct from a clean
   * 'clinician_review' classification, which is not a degraded turn. */
  degraded: Annotation<boolean>({ reducer: (_prev, next) => next, default: () => false }),
  errorMessage: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  /** Set only when this turn actually caused one to exist (escalate()
   * node). clinicianAlertId is set on both the emergency and
   * clinician_review paths; escalationId (the real `escalations` row, not
   * the alert) only on the emergency path — logAiCoachReviewFlag never
   * creates one, matching its own "clinician_review isn't an escalation"
   * design note. */
  clinicianAlertId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  escalationId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  /** §36.14 human handoff — the care_messages thread opened for the patient
   * to see the clinician's reply in-app. Only ever set on the emergency
   * path (see escalate.ts's logAiCoachEscalation) — clinician_review has no
   * real `escalations` row to link a thread to via
   * care_message_threads.escalation_id, so that path is left unlinked for
   * now (docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §7 Phase D). */
  careMessageThreadId: Annotation<string | null>({ reducer: (_prev, next) => next, default: () => null }),
  /** Exactly what was sent to the model for this turn — context lines,
   * retrieved source ids, tools called, prior-message window size. Feeds
   * ai_assistant_turns.input_snapshot (audit.ts), via index.ts. Never the
   * raw patient message body (that already lives in
   * ai_conversations.messages). */
  inputSnapshotForAudit: Annotation<Record<string, unknown>>({ reducer: (_prev, next) => next, default: () => ({}) }),
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
 * `llmTurn` itself has two phases: a bounded tool-calling loop (tools.ts's
 * read-only record tools — vitals, medications, allergies, appointments,
 * conditions, recent labs) so the model can ground an answer in the
 * patient's own record instead of guessing, followed by one final
 * structured call that classifies the tier and produces the reply. The
 * tools are strictly read-only (see tools.ts's own HARD INVARIANT comment)
 * — tool-calling only ever adds grounding before the same classify step
 * that already existed, never a way to bypass it or take an action.
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

    // Deliberately narrow static context — demographics + risk tiers +
    // lifestyle programme state only. Everything else loadPatientContext
    // now also reads (medications, allergies, vitals, labs, appointments,
    // conditions — docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §4.2) is
    // available on demand via the read-only tools below instead of being
    // pushed into every single prompt regardless of relevance — see the
    // architecture doc's §4.1 comparison of "wide static context" against
    // "retrieval tools" and its PHI-minimization reasoning for preferring
    // tools. loadPatientContext's fuller snapshot is also what the Phase C
    // composed surfaces (explain-record, this-month, appointment-prep)
    // read directly, deterministically, with no LLM involved.
    if (context.demographics.ageYears !== null || context.demographics.sex) {
      const parts = [
        context.demographics.ageYears !== null ? `${context.demographics.ageYears} years old` : null,
        context.demographics.sex,
      ].filter(Boolean);
      if (parts.length > 0) contextLines.push(`The patient is ${parts.join(", ")}.`);
    }
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

    // Multi-source retrieval — closes the "one library out of three" gap
    // (docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §2.4/§7 Phase B). Both
    // sources degrade gracefully to nothing when unconfigured (no
    // VOYAGE_API_KEY, or nothing clinician_reviewed yet), so this whole
    // block is a no-op today and starts surfacing content automatically
    // the moment either is populated — no further code change needed.
    const retrievedSourceIds: string[] = [];
    const embedder = deps.embedder ?? createVoyageEmbedderFromEnv();
    if (embedder) {
      // 1. Lifestyle content — deliberately still scoped to the patient's
      // own active (non-paused, non-flagged) lifestyle programme, by
      // design (see find-relevant-content.ts's own docstring). A
      // paused/flagged programme already got a deference instruction
      // above and shouldn't also be handed goal-adjacent reading material.
      const activeProgramme = context.lifestyleProgrammes.find(
        (p) => p.status !== "paused" && !p.hasOpenRedFlag
      );
      if (activeProgramme) {
        const relevant = await findRelevantLifestyleContent(deps.supabase, embedder, state.incomingMessage, {
          matchCount: 2,
          conditionFilter: activeProgramme.condition,
        });
        if (relevant.length > 0) {
          retrievedSourceIds.push(...relevant.map((r) => r.id));
          contextLines.push(
            "Clinician-approved reference material that may be relevant to this message " +
              "(use it to inform your answer in your own words and voice, don't quote it at " +
              "length or present it as a document):\n" +
              relevant.map((r) => `- ${r.title}: ${r.bodyMd}`).join("\n")
          );
        }
      }

      // 2. General health-education content — NOT scoped to lifestyle
      // enrolment (unlike the source above), so a patient with no
      // programme at all still gets grounded, reviewed reference material
      // for a general question. This is the source that was previously
      // not retrievable at all — see the architecture doc §2.4/§4.
      const relevantEducation = await findRelevantHealthEducationContent(deps.supabase, embedder, state.incomingMessage, {
        matchCount: 2,
      });
      if (relevantEducation.length > 0) {
        retrievedSourceIds.push(...relevantEducation.map((r) => r.id));
        contextLines.push(
          "Clinician-approved health education material that may be relevant to this message " +
            "(use it to inform your answer in your own words and voice, don't quote it at length " +
            "or present it as a document):\n" +
            relevantEducation.map((r) => `- ${r.title}: ${r.excerpt}`).join("\n")
        );
      }
    }

    const contextLine = contextLines.join("\n\n");
    const systemPrompt = contextLine ? `${COACH_SYSTEM_PROMPT}\n\n${contextLine}` : COACH_SYSTEM_PROMPT;

    const history = state.priorMessages.map((message) =>
      message.role === "user" ? new HumanMessage(message.content) : new AIMessage(message.content)
    );

    const modelId = getConfiguredModelId();
    const toolsCalled: string[] = [];

    try {
      // Built inside the try block, not at graph-build time — a missing/invalid
      // ANTHROPIC_API_KEY must degrade this turn, not throw before we can catch it.
      const model = deps.model ?? buildAnthropicModel({ maxTokens: 500 });

      // Phase 1: bounded tool-calling loop. Offers the model read-only
      // record lookups so it can ground an answer in the patient's own
      // vitals/medications/allergies/appointments/conditions/labs instead
      // of guessing (docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §4.1). Most
      // turns (general questions, chit-chat) won't trigger a tool call at
      // all — the loop exits after the first response with none.
      const tools = buildPatientRecordTools(deps.supabase, state.profileId);
      const toolsByName = new Map(tools.map((t) => [t.name, t]));
      const modelWithTools = model.bindTools(tools);

      const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
        new SystemMessage(systemPrompt),
        ...history,
        new HumanMessage(state.incomingMessage),
      ];

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const response = await modelWithTools.invoke(messages);
        messages.push(response);
        if (!response.tool_calls || response.tool_calls.length === 0) break;

        for (const call of response.tool_calls) {
          const matchedTool = toolsByName.get(call.name);
          const output = matchedTool
            ? await matchedTool.invoke(call.args)
            : JSON.stringify({ error: `Unknown tool: ${call.name}` });
          toolsCalled.push(call.name);
          messages.push(new ToolMessage({ content: output, tool_call_id: call.id ?? call.name, name: call.name }));
        }
      }

      // Phase 2: final classify+reply call, over the same message history
      // (including whatever tool exchanges just happened) — tool-calling
      // only ever adds grounding ahead of this step, never replaces or
      // bypasses it. A separate structured-output-bound model instance,
      // not modelWithTools, since withStructuredOutput and bindTools
      // configure the request differently.
      const structuredModel = model.withStructuredOutput(structuredReplySchema);
      const result = await structuredModel.invoke(messages);

      const inputSnapshot = {
        contextLines,
        retrievedSourceIds,
        toolsCalled,
        historyMessageCount: history.length,
      };

      // The emergency-tier safety sentence is always the canned copy, never
      // the model's own phrasing of it — see prompts.ts.
      if (result.tier === "emergency") {
        return {
          tier: "emergency" as const,
          reply: `${result.reply}\n\n${EMERGENCY_SAFETY_REPLY}`,
          modelId,
          retrievedSourceIds,
          toolsCalled,
          inputSnapshotForAudit: inputSnapshot,
        };
      }
      return {
        tier: result.tier,
        reply: `${result.reply}\n\n${DISCLAIMER_LINE}`,
        modelId,
        retrievedSourceIds,
        toolsCalled,
        inputSnapshotForAudit: inputSnapshot,
      };
    } catch (error) {
      // Degrading to the patient is correct either way, but swallowing the
      // real cause entirely makes a bad key/model/network issue undebuggable.
      console.error("ai-coach: llmTurn failed, degrading to clinician_review", error);
      return {
        tier: "clinician_review" as const,
        reply: COACH_UNAVAILABLE_REPLY,
        modelId,
        retrievedSourceIds,
        toolsCalled,
        degraded: true,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function escalate(state: CoachGraphState) {
    const { clinicianAlertId, escalationId, careMessageThreadId } = await logAiCoachEscalation(
      deps.supabase,
      deps.getServiceRoleSupabase(),
      {
        organisationId: state.organisationId,
        patientId: state.profileId,
        conversationId: state.conversationId,
        triggerMessage: state.incomingMessage,
      }
    );
    return { clinicianAlertId, escalationId, careMessageThreadId };
  }

  async function logReview(state: CoachGraphState) {
    // Previously audit_log only — correct for the record, but nobody's
    // dashboard reads audit_log, so a real concern could sit unseen
    // indefinitely (see logAiCoachReviewFlag's docstring). Now also opens a
    // real clinician_alerts row so a flagged-but-non-emergency turn actually
    // reaches a worklist, not just a log.
    const { clinicianAlertId } = await logAiCoachReviewFlag(deps.getServiceRoleSupabase(), {
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
    return { clinicianAlertId };
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
