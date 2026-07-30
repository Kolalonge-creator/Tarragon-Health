import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { buildCaseSnapshot, formatSnapshotForPrompt, type CaseSnapshot } from "./snapshot";

const briefSchema = z.object({
  summary: z.string(),
  suggestedAction: z.string(),
});

const MODEL_ID = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are drafting a brief for a doctor about to review a patient escalation on a
clinical platform. You are given a structured, minimized data snapshot -- not the patient's full
chart or clinical notes.

Rules, no exceptions:
- Ground every sentence in the data you were given. Never state a fact, trend, or number that isn't
  in the snapshot.
- Never diagnose. Never suggest a specific medication, dose, or treatment.
- The "suggested action" is a next step for the doctor's OWN review (e.g. "confirm the reading with
  the patient", "check whether this matches their care plan's target range"), never a clinical
  decision made on their behalf.
- Write the summary in 3-5 plain sentences. If the data is thin, say so plainly rather than padding.
- This is a draft for the doctor to read before they review the case themselves -- it is never shown
  to the patient and never treated as the doctor's own assessment.`;

/**
 * Never throws. On any failure (missing/invalid API key, network error,
 * refused response, malformed structured output) this returns a 'failed'
 * result rather than propagating -- the caller (the claim-time trigger, or
 * the manual "Generate" button) must be able to proceed with no brief
 * rather than break the page. Same fail-open discipline as
 * packages/shared/ml-client.ts and the AI Coach's llmTurn.
 */
export async function generateCaseBrief(
  supabase: SupabaseClient<Database>,
  getServiceRoleSupabase: () => SupabaseClient<Database>,
  params: { escalationId: string; organisationId: string; patientId: string },
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic
): Promise<{ status: "generated" | "failed"; summary?: string; suggestedAction?: string }> {
  const { escalationId, organisationId, patientId } = params;

  let snapshot: CaseSnapshot | null = null;
  try {
    snapshot = await buildCaseSnapshot(supabase, escalationId);
  } catch (error) {
    console.error("case-briefs: buildCaseSnapshot failed", error);
  }

  if (!snapshot) {
    await persistFailure(getServiceRoleSupabase(), params, null, "Could not load case data");
    return { status: "failed" };
  }

  const promptText = formatSnapshotForPrompt(snapshot);

  try {
    // Built inside the try block, not passed as a bare default param --
    // a missing/invalid ANTHROPIC_API_KEY must degrade this call, not throw
    // before we can catch it. Same shape as ai-coach/graph.ts's llmTurn.
    const chatModel =
      model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 400,
        // Same claude-*-5-generation workaround as lib/ai-coach/graph.ts's
        // buildModel() -- @langchain/anthropic@0.3.x unconditionally sends
        // temperature/top_p/top_k, which this model generation rejects
        // outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structuredModel = chatModel.withStructuredOutput(briefSchema);

    const result = await structuredModel.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(promptText),
    ]);

    const svc = getServiceRoleSupabase();
    await svc.from("case_briefs").upsert(
      {
        organisation_id: organisationId,
        escalation_id: escalationId,
        patient_id: patientId,
        status: "generated",
        model_id: MODEL_ID,
        summary_text: result.summary,
        suggested_action_text: result.suggestedAction,
        input_snapshot: snapshot as unknown as Json,
        error_message: null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "escalation_id" }
    );

    return { status: "generated", summary: result.summary, suggestedAction: result.suggestedAction };
  } catch (error) {
    console.error("case-briefs: generation failed, degrading to no brief", error);
    await persistFailure(
      getServiceRoleSupabase(),
      params,
      snapshot,
      error instanceof Error ? error.message : "Unknown error"
    );
    return { status: "failed" };
  }
}

async function persistFailure(
  svc: SupabaseClient<Database>,
  params: { escalationId: string; organisationId: string; patientId: string },
  snapshot: CaseSnapshot | null,
  errorMessage: string
): Promise<void> {
  try {
    await svc.from("case_briefs").upsert(
      {
        organisation_id: params.organisationId,
        escalation_id: params.escalationId,
        patient_id: params.patientId,
        status: "failed",
        model_id: MODEL_ID,
        input_snapshot: (snapshot ?? {}) as unknown as Json,
        error_message: errorMessage,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "escalation_id" }
    );
  } catch (error) {
    // Even the failure record failed to write -- log and give up rather than
    // let a persistence problem here take down the caller.
    console.error("case-briefs: could not persist failure record", error);
  }
}
