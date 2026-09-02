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
import { AI_SYSTEMS, governedSystemPrompt, runGovernedAi } from "@/lib/ai-governance";

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

/** Named so runGovernedAi can be parameterised on it. */
export interface ExplainerResult {
  status: "generated" | "failed";
  explanation?: string;
}

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
): Promise<ExplainerResult> {
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

  // AI-003 in the registry. A switched-off or failed explainer lands on the
  // same "no plain-language explanation" state the caller already handles --
  // the result itself, its clinical classification and any abnormal-result
  // escalation are untouched either way, which is the fallback_behaviour
  // recorded for this system.
  const governed = await runGovernedAi<ExplainerResult>({
    supabase,
    systemCode: AI_SYSTEMS.patientResultExplainer.code,
    inputCategory: `result_explanation:${kind}`,
    subjectProfileId: patientId,

    run: async ({ config }) => {
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
        new SystemMessage(
          governedSystemPrompt(config) ?? SYSTEM_PROMPT_TEMPLATE(languageName)
        ),
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

      return {
        value: { status: "generated", explanation: result.explanation },
        modelIdentifier: MODEL_ID,
        outputSummary: result.explanation,
        resultingAction: "explanation_shown_to_patient",
      };
    },

    fallback: async (reason, error) => {
      const detail =
        reason === "ai_error"
          ? error instanceof Error
            ? error.message
            : "Unknown error"
          : `No explanation generated: ${reason}.`;
      if (reason === "ai_error") {
        console.error("patient-explainer: generation failed, degrading to no explanation", error);
      }
      await persistFailure(getServiceRoleSupabase(), params, snapshot, detail);
      return { status: "failed" };
    },
  });

  return governed.value;
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
