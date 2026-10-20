"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";

export type SignState = { error?: string; success?: boolean } | undefined;

const reportConfigSchema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed every value." }),
});

const NOT_ALLOWED = "Only the Chief Medical Officer can sign this.";

/**
 * The Chief Medical Officer signs the yearly Health Report settings (targets, minimum readings, windows, suggested recheck weeks, the fixed statement).
 * Two checks: this action refuses anyone who is not the CMO, and the database function refuses again. Nothing here signs on its own.
 */
export async function signHealthReportConfig(_prev: SignState, formData: FormData): Promise<SignState> {
  if (!canAssignCases(await getCurrentClinicalStaff())) return { error: NOT_ALLOWED };
  const parsed = reportConfigSchema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "health_report_config_versions", parsed.data.id);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_health_report_config", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? NOT_ALLOWED : "That did not work. Please try again." };
  revalidatePath("/clinician/health-report-config");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}

const thresholdSchema = z.object({
  id: z.string().uuid(),
  reviewed: z.literal(true, { message: "Please confirm you have reviewed the threshold." }),
});

/** The Chief Medical Officer confirms the anti-HBs immunity threshold on the active serology rule. Until then a titre alone never records immunity. */
export async function signSerologyThreshold(_prev: SignState, formData: FormData): Promise<SignState> {
  if (!canAssignCases(await getCurrentClinicalStaff())) return { error: NOT_ALLOWED };
  const parsed = thresholdSchema.safeParse({ id: String(formData.get("id") ?? ""), reviewed: formData.get("reviewed") === "on" ? true : undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_serology_rule_threshold", { p_id: parsed.data.id });
  if (error) return { error: error.message.includes("not authorised") ? NOT_ALLOWED : "That did not work. Please try again." };
  revalidatePath("/clinician/serology-rules");
  revalidatePath("/clinician/clinical-signoff");
  return { success: true };
}
