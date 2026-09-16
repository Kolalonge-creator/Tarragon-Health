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
  model?: ChatAnthropic,
): Promise<{ status: "generated" | "failed"; questions?: string[] }> {
  const { patientId, organisationId, consultationId } = params;

  let snapshot: AppointmentPrepSnapshot | null = null;
  try {
    snapshot = await buildAppointmentPrepSnapshot(
      supabase,
      patientId,
      consultationId,
    );
  } catch (error) {
    console.error(
      "appointment-prep: buildAppointmentPrepSnapshot failed",
      error,
    );
  }

  if (!snapshot) {
    await persistFailure(
      getServiceRoleSupabase(),
      params,
      null,
      "Could not find this visit",
    );
    return { status: "failed" };
  }

  const promptText = formatAppointmentPrepSnapshotForPrompt(snapshot);
  const resolvedSnapshot = snapshot;

  // AI-013. This call site ran with no registry entry at all until
  // 2026-09-16 — no kill switch, no audit trail, no guardrail record. See the
  // 20260916162244 migration header. runGovernedAi checks the kill switch
  // before the model is reached and records the outcome either way; the
  // fallback is the failure record this function already wrote, so a
  // switched-off system and a model error now look the same to the caller.
  const governed = await runGovernedAi<{
    status: "generated" | "failed";
    questions?: string[];
  }>({
    supabase,
    systemCode: AI_SYSTEMS.appointmentPrepSuggestions.code,
    inputCategory: "appointment_prep_snapshot",
    subjectProfileId: patientId,

    run: async ({ config }) => {
      const chatModel =
        model ??
        new ChatAnthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          model: MODEL_ID,
          maxTokens: 400,
          // Same claude-*-5-generation workaround as ai-coach/model.ts --
          // @langchain/anthropic@0.3.x unconditionally sends temperature/top_p/
          // top_k, which this model generation rejects outright.
          invocationKwargs: {
            temperature: undefined,
            top_p: undefined,
            top_k: undefined,
          },
        });
      const structuredModel = chatModel.withStructuredOutput(suggestionsSchema);

      const result = await structuredModel.invoke([
        // The governed prompt when a Clinical Director has activated one for
        // AI-013, else the in-repo constant — which must stay a working
        // default, never an empty string.
        new SystemMessage(governedSystemPrompt(config) ?? SYSTEM_PROMPT),
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
          input_snapshot: resolvedSnapshot as unknown as Json,
          error_message: null,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "patient_id,consultation_id" },
      );

      return {
        value: { status: "generated" as const, questions: result.questions },
        modelIdentifier: MODEL_ID,
        outputSummary: `${result.questions.length} suggested questions`,
        resultingAction: "appointment_prep_suggestions_generated",
        resultingEntityType: "appointment_prep_suggestions",
        resultingEntityId: consultationId,
      };
    },

    fallback: async (reason, error) => {
      const message =
        reason === "ai_error"
          ? error instanceof Error
            ? error.message
            : "Unknown error"
          : `AI-013 unavailable: ${reason}`;
      console.error("appointment-prep: degrading to no suggestions", {
        reason,
        error,
      });
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

async function persistFailure(
  svc: SupabaseClient<Database>,
  params: GenerateParams,
  snapshot: AppointmentPrepSnapshot | null,
  errorMessage: string,
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
      { onConflict: "patient_id,consultation_id" },
    );
  } catch (error) {
    console.error("appointment-prep: could not persist failure record", error);
  }
}
