import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import {
  AI_SYSTEMS,
  governedSystemPrompt,
  runGovernedAi,
} from "@/lib/ai-governance";
import {
  buildDraftReplySnapshot,
  formatDraftReplySnapshotForPrompt,
  type DraftReplySnapshot,
} from "./draft-reply-snapshot";

const draftReplySchema = z.object({
  draftReply: z.string(),
  needsClinicalReview: z.boolean(),
  reviewReason: z.string().nullable(),
});

const MODEL_ID = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are drafting a reply for a Tarragon Health Care Coordinator (non-clinical staff) to send a
patient in an in-app care-message thread. You are given a minimized transcript of the recent
messages in the thread -- not the patient's full chart or clinical notes.

The Care Coordinator's role is strictly non-clinical: logistics, adherence encouragement,
scheduling, and general support (docs/Tarragon_Health_Master_Operating_Plan_v4.md Section 4). They
never interpret a result, never discuss a medication change, and never give a clinical opinion.

Rules, no exceptions:
- Never diagnose. Never suggest, discuss, or change a medication, dose, or treatment.
- Never interpret a lab/vitals result or tell the patient what a reading or symptom means.
- If the patient's most recent message describes a new or worsening symptom, asks a clinical
  question (about a result, a medication, or their condition), or otherwise sounds like it needs a
  clinician's judgment: do NOT draft a substantive reply. Draft only a short, warm holding reply
  that acknowledges the message and says a member of the clinical team will follow up -- and set
  needsClinicalReview to true with a one-sentence reviewReason.
- Otherwise, draft a warm, concise reply (2-4 sentences) covering only what a Care Coordinator may
  actually do -- encouragement, adherence support, scheduling or logistics, or a general check-in --
  in Tarragon's voice (warm and personal, no clinical jargon, no fear-based urgency, never a
  hospital-PA tone). Set needsClinicalReview to false and leave reviewReason null.
- This is a draft for a human to read, edit, and decide whether to send. It is never sent
  automatically, and it must never claim to be from a doctor.`;

type GenerateParams = {
  threadId: string;
  organisationId: string;
  patientId: string;
};

/**
 * Never throws. On any failure (missing/invalid API key, network error,
 * refused response, malformed structured output) this returns a 'failed'
 * result rather than propagating -- the caller (the "Draft reply" control
 * in the thread view) must be able to proceed with no draft rather than
 * break the page. Same fail-open discipline as lib/case-briefs/generate.ts
 * and the AI Coach's llmTurn.
 *
 * Keyed by thread_id, upserted on every regenerate -- one draft serves the
 * whole thread, so a staff member composing a reply always sees the latest
 * suggestion for the latest patient message.
 */
export async function generateDraftReply(
  supabase: SupabaseClient<Database>,
  getServiceRoleSupabase: () => SupabaseClient<Database>,
  params: GenerateParams,
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic,
): Promise<DraftReplyResult> {
  const { threadId, organisationId, patientId } = params;

  let snapshot: DraftReplySnapshot | null = null;
  try {
    snapshot = await buildDraftReplySnapshot(supabase, threadId);
  } catch (error) {
    console.error("care-messages: buildDraftReplySnapshot failed", error);
  }

  if (!snapshot) {
    await persistFailure(
      getServiceRoleSupabase(),
      params,
      null,
      "Could not load thread data",
    );
    return { status: "failed" };
  }

  const promptText = formatDraftReplySnapshotForPrompt(snapshot);
  const resolvedSnapshot = snapshot;

  // AI-014. This call site ran with no registry entry at all until
  // 2026-09-16 — no kill switch, no audit trail, no guardrail record, despite
  // drafting text a non-clinical staff member may send to a patient. See the
  // 20260916162244 migration header.
  const governed = await runGovernedAi<DraftReplyResult>({
    supabase,
    systemCode: AI_SYSTEMS.careCoordinatorDraftReply.code,
    inputCategory: "care_message_thread_transcript",
    subjectProfileId: patientId,

    run: async ({ config }) => {
      // Built inside the governed run, not passed as a bare default param -- a
      // missing/invalid ANTHROPIC_API_KEY must degrade this call, not throw
      // before we can catch it. Same shape as lib/case-briefs/generate.ts.
      const chatModel =
        model ??
        new ChatAnthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          model: MODEL_ID,
          maxTokens: 300,
          // Same claude-*-5-generation workaround as lib/case-briefs/generate.ts
          // and lib/ai-coach/graph.ts's buildAnthropicModel() -- @langchain/
          // anthropic@0.3.x unconditionally sends temperature/top_p/top_k,
          // which this model generation rejects outright.
          invocationKwargs: {
            temperature: undefined,
            top_p: undefined,
            top_k: undefined,
          },
        });
      const structuredModel = chatModel.withStructuredOutput(draftReplySchema);

      const result = await structuredModel.invoke([
        // The governed prompt when a Clinical Director has activated one for
        // AI-014, else the in-repo constant — which must stay a working
        // default, never an empty string.
        new SystemMessage(governedSystemPrompt(config) ?? SYSTEM_PROMPT),
        new HumanMessage(promptText),
      ]);

      const svc = getServiceRoleSupabase();
      await svc.from("care_message_draft_replies").upsert(
        {
          organisation_id: organisationId,
          patient_id: patientId,
          thread_id: threadId,
          status: "generated",
          model_id: MODEL_ID,
          draft_text: result.draftReply,
          needs_clinical_review: result.needsClinicalReview,
          review_reason: result.reviewReason,
          input_snapshot: snapshot as unknown as Json,
          error_message: null,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "thread_id" },
      );

      return {
        value: {
          status: "generated" as const,
          draftText: result.draftReply,
          needsClinicalReview: result.needsClinicalReview,
          reviewReason: result.reviewReason,
        },
        modelIdentifier: MODEL_ID,
        // A category, never the patient's or the draft's words -- the audit
        // trail records that a draft was produced and whether it held for a
        // clinician, not the clinical content of a care-message thread.
        outputSummary: result.needsClinicalReview
          ? "held for clinical review"
          : "non-clinical draft produced",
        // The AI-014 guardrail that actually matters at runtime: a clinical
        // question must produce a holding reply, not an answer. Recording it
        // when it fires is what makes the escalate-enforcement guardrail
        // measurable rather than merely written down.
        guardrailsTriggered: result.needsClinicalReview
          ? ["clinical_question_holds_for_clinician"]
          : [],
        resultingAction: result.needsClinicalReview
          ? "held_for_clinical_review"
          : "draft_reply_generated",
        resultingEntityType: "care_message_draft_replies",
        resultingEntityId: threadId,
      };
    },

    fallback: async (reason, error) => {
      const message =
        reason === "ai_error"
          ? error instanceof Error
            ? error.message
            : "Unknown error"
          : `AI-014 unavailable: ${reason}`;
      console.error("care-messages: degrading to no draft", { reason, error });
      await persistFailure(
        getServiceRoleSupabase(),
        params,
        resolvedSnapshot,
        message,
      );
      return { status: "failed" as const };
    },
  });

  return governed.value;
}

interface DraftReplyResult {
  status: "generated" | "failed";
  draftText?: string;
  needsClinicalReview?: boolean;
  reviewReason?: string | null;
}

async function persistFailure(
  svc: SupabaseClient<Database>,
  params: GenerateParams,
  snapshot: DraftReplySnapshot | null,
  errorMessage: string,
): Promise<void> {
  try {
    await svc.from("care_message_draft_replies").upsert(
      {
        organisation_id: params.organisationId,
        patient_id: params.patientId,
        thread_id: params.threadId,
        status: "failed",
        model_id: MODEL_ID,
        input_snapshot: (snapshot ?? {}) as unknown as Json,
        error_message: errorMessage,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "thread_id" },
    );
  } catch (error) {
    // Even the failure record failed to write -- log and give up rather than
    // let a persistence problem here take down the caller.
    console.error(
      "care-messages: could not persist draft-reply failure record",
      error,
    );
  }
}
