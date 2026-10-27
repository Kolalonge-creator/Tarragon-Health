"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { AI_RISK_SYSTEM_CODE, explainSignError, signAcceptanceSchema } from "@/lib/clinician/ai-risk-acceptance";

export type SignState = { error?: string; done?: boolean } | undefined;

/** The Chief Medical Officer signs the risk acceptance. The database refuses anyone else, and its reason is shown as it is. */
export async function signRiskAcceptance(_prev: SignState, formData: FormData): Promise<SignState> {
  const runRaw = String(formData.get("evaluation_run_id") ?? "").trim();
  const parsed = signAcceptanceSchema.safeParse({
    summary: String(formData.get("summary") ?? ""),
    validUntil: String(formData.get("valid_until") ?? ""),
    evaluationRunId: runRaw === "" ? null : runRaw,
    noRerunYet: formData.get("no_rerun_yet") === "on",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message;
    if (first === "summary_short") return { error: "Please write at least a sentence about the risk you are accepting." };
    if (first === "date_missing") return { error: "Choose an end date." };
    if (first === "rerun_link") return { error: "Choose a re-evaluation run, or tick that none has been re-run yet (not both)." };
    return { error: "Please check the details and try again." };
  }
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("sign_ai_risk_acceptance", {
    p_system_code: AI_RISK_SYSTEM_CODE,
    p_summary: parsed.data.summary,
    p_valid_until: parsed.data.validUntil,
    p_evaluation_run: parsed.data.evaluationRunId,
    p_no_rerun_yet: parsed.data.noRerunYet,
  });
  if (error) return { error: explainSignError(error.message) };
  revalidatePath("/clinician/ai-risk-acceptance");
  return { done: true };
}
