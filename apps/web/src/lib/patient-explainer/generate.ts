import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import {
  buildMedicationSnapshot,
  buildResultSnapshot,
  formatMedicationSnapshotForPrompt,
  formatResultSnapshotForPrompt,
  type ExplainerKind,
  type MedicationSnapshot,
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

const SYSTEM_PROMPT_TEMPLATE = (languageName: string) => `You are helping a patient understand ONE
number from their own health record on a Nigerian digital health platform. You are given a
minimized, structured snapshot -- one measurement's latest and (if available) previous value --
never the patient's full chart.

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
- If the data is thin (no previous value), say so plainly rather than inventing a trend.`;

const MEDICATION_SYSTEM_PROMPT_TEMPLATE = (languageName: string) => `You are helping a patient
understand ONE medication on their own health record on a Nigerian digital health platform. You are
given a minimized, structured snapshot of just this medication -- never the patient's full
medication list.

Rules, no exceptions:
- Write in ${languageName}. Keep it short and practical -- a few plain sentences, not an essay.
- Ground every sentence in the data you were given or in well-established, general facts about a
  medication with this exact name. Never invent a purpose, side effect, or precaution you are not
  reasonably confident about for this specific medication.
- Cover, briefly, whatever of these genuinely applies: what this kind of medication is generally
  used for, how it is typically taken, common side effects to be aware of, important general
  precautions, whether any monitoring (e.g. blood tests) is typically needed, and what to do if the
  patient has concerns.
- Never change, confirm, or suggest a dose. Never tell the patient to start, stop, switch, or skip a
  dose of this or any medication -- that decision belongs to their care team.
- Never diagnose, and never claim this medication treats a specific condition beyond what is in the
  snapshot's recorded reason (if any).
- Always end with one short sentence encouraging the patient to bring any questions or side effects
  to their care team or pharmacist before changing anything.
- If you are not confident about general facts for a medication with this exact name, say so plainly
  and encourage the patient to ask their care team or pharmacist, rather than guessing.`;

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
 *
 * Dispatches on kind: "medication" has a different snapshot shape (no
 * latest/previous trend) and a different, dedicated system prompt (the six
 * medication-education sections from docs Module 20 §20.7), so it's handled
 * by a sibling function rather than forced into the result-explanation shape.
 */
export async function generatePatientExplanation(
  supabase: SupabaseClient<Database>,
  getServiceRoleSupabase: () => SupabaseClient<Database>,
  params: GenerateParams,
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic
): Promise<{ status: "generated" | "failed"; explanation?: string }> {
  if (params.kind === "medication") {
    return generateMedicationExplanation(supabase, getServiceRoleSupabase, params, model);
  }
  return generateResultExplanation(supabase, getServiceRoleSupabase, params, model);
}

async function generateResultExplanation(
  supabase: SupabaseClient<Database>,
  getServiceRoleSupabase: () => SupabaseClient<Database>,
  params: GenerateParams,
  model?: ChatAnthropic
): Promise<{ status: "generated" | "failed"; explanation?: string }> {
  if (params.kind === "medication") {
    // Narrowed away by the dispatcher above; unreachable, kept only so
    // buildResultSnapshot's narrower kind type checks below.
    return { status: "failed" };
  }
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
      new SystemMessage(SYSTEM_PROMPT_TEMPLATE(languageName)),
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

async function generateMedicationExplanation(
  supabase: SupabaseClient<Database>,
  getServiceRoleSupabase: () => SupabaseClient<Database>,
  params: GenerateParams,
  model?: ChatAnthropic
): Promise<{ status: "generated" | "failed"; explanation?: string }> {
  const { patientId, organisationId, subjectKey, label, language } = params;

  let snapshot: MedicationSnapshot | null = null;
  try {
    snapshot = await buildMedicationSnapshot(supabase, patientId, subjectKey, label);
  } catch (error) {
    console.error("patient-explainer: buildMedicationSnapshot failed", error);
  }

  if (!snapshot) {
    await persistFailure(getServiceRoleSupabase(), params, null, "Medication not found on file");
    return { status: "failed" };
  }

  const languageName = EXPLAINER_LANGUAGE_NAME[language] ?? EXPLAINER_LANGUAGE_NAME.en;
  const promptText = formatMedicationSnapshotForPrompt(snapshot);

  try {
    const chatModel =
      model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 400,
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structuredModel = chatModel.withStructuredOutput(explanationSchema);

    const result = await structuredModel.invoke([
      new SystemMessage(MEDICATION_SYSTEM_PROMPT_TEMPLATE(languageName)),
      new HumanMessage(promptText),
    ]);

    const svc = getServiceRoleSupabase();
    await svc.from("patient_result_explanations").upsert(
      {
        organisation_id: organisationId,
        patient_id: patientId,
        kind: "medication",
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
    console.error("patient-explainer: medication generation failed, degrading to no explanation", error);
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
  snapshot: ResultSnapshot | MedicationSnapshot | null,
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
