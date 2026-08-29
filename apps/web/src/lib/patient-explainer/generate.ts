import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import {
  buildResultSnapshot,
  formatResultSnapshotForPrompt,
  type ExplainerKind,
  type ResultSnapshot,
} from "./snapshot";

const explanationSchema = z.object({ explanation: z.string() });

const MODEL_ID = "claude-haiku-4-5";

/** Matches profiles.language's CHECK constraint exactly (20260723201654). */
export const EXPLAINER_LANGUAGE_NAME: Record<string, string> = {
  en: "English",
  pcm: "Nigerian Pidgin",
  yo: "Yoruba",
  ha: "Hausa",
  ig: "Igbo",
};

/** What the patient is actually asking about, per kind -- keeps the shared
 * rule block below honest for kinds that aren't "one number" (a medication,
 * a care-plan condition). */
const KIND_FRAMING: Record<ExplainerKind, string> = {
  risk_score: "ONE number from their own health record",
  lab_analyte: "ONE number from their own health record",
  vitals: "ONE number from their own health record",
  medication: "ONE medication they've been prescribed -- how to take it, general precautions, and common effects",
  care_plan_item: "ONE condition on their own care plan -- why it's being monitored and what any target range means",
};

/** Extra rule appended only for kinds where the base "never suggest a
 * medication, dose, or specific treatment" line needs to be spelled out
 * more explicitly, since the whole snapshot is about a medication. */
const KIND_EXTRA_RULE: Partial<Record<ExplainerKind, string>> = {
  medication: `\n- Never suggest changing the dose, frequency, route, or stopping this medication, even if the
  patient's question implies they want that. If they ask about changing anything, tell them to ask
  their care team or pharmacist first.`,
  care_plan_item: `\n- Explain only the condition named in the snapshot -- never speculate about a different
  condition, and never explain a target range as if it were a diagnosis threshold.`,
};

const SYSTEM_PROMPT_TEMPLATE = (languageName: string, kind: ExplainerKind) => `You are helping a patient understand
${KIND_FRAMING[kind]} on a Nigerian digital health platform. You are given a minimized, structured
snapshot -- never the patient's full chart.

Rules, no exceptions:
- Write in ${languageName}. Keep it short: 3-4 plain, warm sentences a worried, possibly first-time
  patient can follow without a medical dictionary.
- Ground every sentence in the data you were given. Never state a fact, trend, or number that isn't
  in the snapshot.
- Never diagnose. Never say what condition this means the patient has. Never suggest a medication,
  dose, or specific treatment.
- Never tell the patient to worry, and never tell them everything is fine either -- describe what
  the number is and, if a previous value exists, whether it moved up, down, or stayed about the
  same, in plain language.
- Always end with one short sentence encouraging them to bring any questions to their care team --
  this explanation is for understanding, not a diagnosis or a substitute for their doctor.
- If the data is thin (no previous value), say so plainly rather than inventing a trend.${KIND_EXTRA_RULE[kind] ?? ""}`;

type GenerateParams = {
  patientId: string;
  organisationId: string;
  kind: ExplainerKind;
  subjectKey: string;
  label: string;
  language: string;
};

/**
 * Never throws. Same fail-open discipline as case-briefs/generate.ts and
 * packages/shared/ml-client.ts -- on any failure this persists a 'failed'
 * row and the caller (explainPatientResultAction) shows "couldn't generate
 * an explanation" rather than breaking the page.
 */
export async function generatePatientExplanation(
  supabase: SupabaseClient<Database>,
  getServiceRoleSupabase: () => SupabaseClient<Database>,
  params: GenerateParams,
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic
): Promise<{ status: "generated" | "failed"; explanation?: string }> {
  const { patientId, organisationId, kind, subjectKey, label, language } = params;

  let snapshot: ResultSnapshot | null = null;
  try {
    snapshot = await buildResultSnapshot(supabase, patientId, kind, subjectKey, label);
  } catch (error) {
    console.error("patient-explainer: buildResultSnapshot failed", error);
  }

  if (!snapshot) {
    await persistFailure(getServiceRoleSupabase(), params, null, "No data recorded yet for this measurement");
    return { status: "failed" };
  }

  const languageName = EXPLAINER_LANGUAGE_NAME[language] ?? EXPLAINER_LANGUAGE_NAME.en;
  const promptText = formatResultSnapshotForPrompt(snapshot);

  try {
    const chatModel =
      model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 300,
        // Same claude-*-5-generation workaround as case-briefs/generate.ts --
        // @langchain/anthropic@0.3.x unconditionally sends temperature/top_p/
        // top_k, which this model generation rejects outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structuredModel = chatModel.withStructuredOutput(explanationSchema);

    const result = await structuredModel.invoke([
      new SystemMessage(SYSTEM_PROMPT_TEMPLATE(languageName, kind)),
      new HumanMessage(promptText),
    ]);

    const svc = getServiceRoleSupabase();
    await svc.from("patient_result_explanations").upsert(
      {
        organisation_id: organisationId,
        patient_id: patientId,
        kind,
        subject_key: subjectKey,
        language,
        status: "generated",
        model_id: MODEL_ID,
        explanation_text: result.explanation,
        input_snapshot: snapshot as unknown as Json,
        error_message: null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "patient_id,kind,subject_key,language" }
    );

    return { status: "generated", explanation: result.explanation };
  } catch (error) {
    console.error("patient-explainer: generation failed, degrading to no explanation", error);
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
  snapshot: ResultSnapshot | null,
  errorMessage: string
): Promise<void> {
  try {
    await svc.from("patient_result_explanations").upsert(
      {
        organisation_id: params.organisationId,
        patient_id: params.patientId,
        kind: params.kind,
        subject_key: params.subjectKey,
        language: params.language,
        status: "failed",
        model_id: MODEL_ID,
        input_snapshot: (snapshot ?? {}) as unknown as Json,
        error_message: errorMessage,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "patient_id,kind,subject_key,language" }
    );
  } catch (error) {
    console.error("patient-explainer: could not persist failure record", error);
  }
}
