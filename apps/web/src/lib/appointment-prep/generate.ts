import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import {
  buildAppointmentPrepSnapshot,
  formatAppointmentPrepSnapshotForPrompt,
  type AppointmentPrepSnapshot,
} from "./snapshot";

const suggestionsSchema = z.object({
  questions: z.array(z.string()).min(3).max(6),
});

const MODEL_ID = "claude-haiku-4-5";

const SYSTEM_PROMPT = `You are helping a patient prepare for an upcoming video visit with their care team on a
Nigerian digital health platform. You are given a minimized, structured snapshot of why the visit
was booked and the patient's known care-plan conditions -- never their full chart.

Rules, no exceptions:
- Suggest 3-6 short, specific questions or topics, written in the patient's own voice (first
  person, e.g. "Can we talk about..." or "I want to ask about..."), that they could bring up at
  the visit.
- Ground every suggestion in the data you were given. Never state a fact, trend, or number that
  isn't in the snapshot.
- Never diagnose. Never suggest a medication, dose, or specific treatment -- these are questions
  for the patient to ask their care team, not answers.
- If no specific flagged concern is on file, suggest general questions appropriate to the visit
  type and known conditions instead of guessing a specific reason for the visit.
- Keep each suggestion to one short sentence.`;

type GenerateParams = {
  patientId: string;
  organisationId: string;
  consultationId: string;
};

/**
 * Never throws. Same fail-open discipline as patient-explainer/generate.ts
 * -- on any failure this persists a 'failed' row and the caller shows
 * "couldn't put together suggestions" rather than breaking the page.
 */
export async function generateAppointmentPrepSuggestions(
  supabase: SupabaseClient<Database>,
  getServiceRoleSupabase: () => SupabaseClient<Database>,
  params: GenerateParams,
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic
): Promise<{ status: "generated" | "failed"; questions?: string[] }> {
  const { patientId, organisationId, consultationId } = params;

  let snapshot: AppointmentPrepSnapshot | null = null;
  try {
    snapshot = await buildAppointmentPrepSnapshot(supabase, patientId, consultationId);
  } catch (error) {
    console.error("appointment-prep: buildAppointmentPrepSnapshot failed", error);
  }

  if (!snapshot) {
    await persistFailure(getServiceRoleSupabase(), params, null, "Could not find this visit");
    return { status: "failed" };
  }

  const promptText = formatAppointmentPrepSnapshotForPrompt(snapshot);

  try {
    const chatModel =
      model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 400,
        // Same claude-*-5-generation workaround as ai-coach/model.ts --
        // @langchain/anthropic@0.3.x unconditionally sends temperature/top_p/
        // top_k, which this model generation rejects outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structuredModel = chatModel.withStructuredOutput(suggestionsSchema);

    const result = await structuredModel.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(promptText),
    ]);

    const svc = getServiceRoleSupabase();
    await svc.from("appointment_prep_suggestions").upsert(
      {
        organisation_id: organisationId,
        patient_id: patientId,
        consultation_id: consultationId,
        status: "generated",
        model_id: MODEL_ID,
        questions: result.questions as unknown as Json,
        input_snapshot: snapshot as unknown as Json,
        error_message: null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "patient_id,consultation_id" }
    );

    return { status: "generated", questions: result.questions };
  } catch (error) {
    console.error("appointment-prep: generation failed, degrading to no suggestions", error);
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
  params: GenerateParams,
  snapshot: AppointmentPrepSnapshot | null,
  errorMessage: string
): Promise<void> {
  try {
    await svc.from("appointment_prep_suggestions").upsert(
      {
        organisation_id: params.organisationId,
        patient_id: params.patientId,
        consultation_id: params.consultationId,
        status: "failed",
        model_id: MODEL_ID,
        questions: [] as unknown as Json,
        input_snapshot: (snapshot ?? {}) as unknown as Json,
        error_message: errorMessage,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "patient_id,consultation_id" }
    );
  } catch (error) {
    console.error("appointment-prep: could not persist failure record", error);
  }
}
