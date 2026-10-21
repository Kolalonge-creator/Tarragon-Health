"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@tarragon/shared";
import { validateRuleSet, type RuleSetError } from "@tarragon/medicines";
import { createClient } from "@/lib/supabase/server";
import { refuseSupersededDraft } from "@/lib/clinical/refuse-superseded-draft";
import { getCurrentProfile, getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";

export type CreateMedicineInteractionRulesDraftState = { error?: string; success?: boolean } | undefined;
export type SignMedicineInteractionRulesState = { error?: string; success?: boolean } | undefined;

const PATHS = ["/clinician/medicine-interaction-rules", "/admin/settings/medicine-interaction-rules", "/clinician/clinical-signoff"];

function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

const ERROR_TEXT: Record<RuleSetError, string> = {
  not_an_object: "The text must be one JSON object with a \"rules\" list.",
  rules_not_a_list: "\"rules\" must be a list.",
  too_many_rules: "A set can hold at most 500 rules.",
  rule_not_an_object: "Each rule must be an object.",
  bad_code: "Each rule needs a short code of lower case letters, digits and underscores.",
  duplicate_code: "Two rules share a code. Each code must be different.",
  ingredient_not_normalised: "Ingredient names must be lower case letters and digits with single spaces, for example \"amoxicillin\".",
  same_ingredient: "A rule needs two different ingredients.",
  bad_severity: "Severity must be contraindicated, caution or info.",
  source_missing: "Every rule needs a public source a reviewer can check.",
};

/**
 * Open a new draft rule set from pasted JSON. The text is checked with the same function the database repeats as a table check.
 * An admin or the Chief Medical Officer may draft; only the active Chief Medical Officer may sign (the database decides, below).
 * Nothing here authors a rule: the content is whatever a pharmacist and clinicians wrote and cited.
 */
export async function createMedicineInteractionRulesDraftAction(
  _prev: CreateMedicineInteractionRulesDraftState,
  formData: FormData
): Promise<CreateMedicineInteractionRulesDraftState> {
  const profile = await getCurrentProfile();
  const staff = await getCurrentClinicalStaff();
  if (profile?.role !== "admin" && !canAssignCases(staff)) return { error: "Not authorised" };

  const text = String(formData.get("rules_json") ?? "").trim();
  if (text.length === 0) return { error: "Paste the rules as JSON first." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That is not valid JSON." };
  }
  const checked = validateRuleSet(parsed);
  if (!checked.ok) return { error: [...new Set(checked.errors)].map((e) => ERROR_TEXT[e]).join(" ") };
  if (checked.rules.length === 0) return { error: "A set with no rules cannot be signed, so it is not saved." };

  const supabase = await createClient();
  const { data: latest, error: latestError } = await supabase
    .from("medicine_interaction_rule_sets")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { error: latestError.message };
  const nextVersion = (latest?.version ?? 0) + 1;
  const notes = String(formData.get("notes") ?? "").trim() || `Drafted for review, version ${nextVersion}. A pharmacist reviews it before the Chief Medical Officer signs.`;
  const { error } = await supabase.from("medicine_interaction_rule_sets").insert({ version: nextVersion, config: { rules: checked.rules } as unknown as Json, notes });
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}

/**
 * Sign and activate a version. The database function is the real gate: it succeeds only for the active Chief Medical Officer, refuses
 * an empty set, and stamps who signed from their own staff record. Nothing in the platform signs this on anyone's behalf.
 */
export async function signMedicineInteractionRulesAction(rulesId: string): Promise<SignMedicineInteractionRulesState> {
  const supabase = await createClient();
  const refused = await refuseSupersededDraft(supabase, "medicine_interaction_rule_sets", rulesId);
  if (refused) return { error: refused };
  const { error } = await supabase.rpc("sign_medicine_interaction_rule_sets", { p_rules_id: rulesId });
  if (error) return { error: error.message };
  refresh();
  return { success: true };
}
