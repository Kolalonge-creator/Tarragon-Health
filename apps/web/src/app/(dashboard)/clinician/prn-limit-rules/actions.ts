"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";

export type CreatePrnLimitRulesDraftState = { error?: string; success?: boolean } | undefined;
export type SignPrnLimitRulesState = { error?: string; success?: boolean } | undefined;

const PATHS = ["/clinician/prn-limit-rules", "/admin/settings/prn-limit-rules", "/clinician/clinical-signoff"];

function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

/**
 * Open a new draft that repeats the latest version's bounds and repeat rule exactly. A change to a bound is a
 * reviewed change to the proposed configuration first (`medicines.prn_limits`), then a new migration row; this
 * form only re-attests an unchanged rule or brings a migration-added draft into view. An admin or the Chief
 * Medical Officer may draft; only the Chief Medical Officer may sign (the database decides, below).
 */
export async function createPrnLimitRulesDraftAction(
  _prev: CreatePrnLimitRulesDraftState,
  formData: FormData
): Promise<CreatePrnLimitRulesDraftState> {
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();
  if (profile?.role !== "admin" && !canAssignCases(staff)) return { error: "Not authorised" };

  const supabase = await createClient();
  const { data: latest, error: latestError } = await supabase
    .from("prn_limit_rules")
    .select("version, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { error: latestError.message };
  if (!latest) return { error: "No existing as-needed limits rule version found to draft from." };

  const nextVersion = latest.version + 1;
  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Re-attested, version ${nextVersion}, unchanged from version ${latest.version}. Sign to bring into force.`;
  const { error } = await supabase.from("prn_limit_rules").insert({ version: nextVersion, config: latest.config, notes });
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}

/**
 * Sign and activate a version. The database function is the real gate: it succeeds only for the active Chief
 * Medical Officer and stamps who signed from their own staff record, so a signature cannot be forged from here.
 * Nothing in the platform signs this rule on anyone's behalf.
 */
export async function signPrnLimitRulesAction(rulesId: string): Promise<SignPrnLimitRulesState> {
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "prn_limit_rules", rulesId);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_prn_limit_rules", { p_rules_id: rulesId });
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}
