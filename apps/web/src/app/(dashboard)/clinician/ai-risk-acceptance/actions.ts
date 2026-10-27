"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { AI_RISK_SYSTEM_CODE, signAcceptanceSchema } from "@/lib/clinician/ai-risk-acceptance";

export type SignState = { error?: string; done?: boolean } | undefined;

/** The Chief Medical Officer signs the risk acceptance. The database refuses anyone else. */
export async function signRiskAcceptance(_prev: SignState, formData: FormData): Promise<SignState> {
  const parsed = signAcceptanceSchema.safeParse({
    summary: String(formData.get("summary") ?? ""),
    validUntil: String(formData.get("valid_until") ?? ""),
  });
  if (!parsed.success) return { error: "Write at least a sentence about the risk you are accepting, and choose an end date." };
  const supabase = loose(await createClient());
  const { error } = await supabase.rpc("sign_ai_risk_acceptance", {
    p_system_code: AI_RISK_SYSTEM_CODE,
    p_summary: parsed.data.summary,
    p_valid_until: parsed.data.validUntil,
  });
  if (error) return { error: "That could not be signed. Check the end date is within 90 days." };
  revalidatePath("/clinician/ai-risk-acceptance");
  return { done: true };
}
