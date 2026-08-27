"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { riskQuestionnaireConfigJsonSchema } from "@/lib/validation/risk-questionnaire-config";
import type { Json } from "@tarragon/shared";

export type SignRiskQuestionnaireConfigState = { error?: string; success?: boolean } | undefined;
export type SaveRiskQuestionnaireConfigState = { error?: string; success?: boolean } | undefined;

const QUESTIONNAIRE_CODE = "prevention_intake";

/**
 * Creates a NEW version of the prevention_intake questionnaire config from
 * pasted/edited JSON. Inserted as an unsigned, inactive draft — RLS forces
 * approved_by null / is_active false on insert, same as cv_risk_config — a
 * Clinical Director then signs it to bring it into force. Editing never
 * mutates a signed version; every change is a new version.
 */
export async function createRiskQuestionnaireConfigDraftAction(
  _prev: SaveRiskQuestionnaireConfigState,
  formData: FormData
): Promise<SaveRiskQuestionnaireConfigState> {
  const parsed = riskQuestionnaireConfigJsonSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid values" };
  }

  const profile = await getCurrentProfile();
  if (profile?.role !== "admin" || !profile.organisation_id) {
    return { error: "Not authorised" };
  }
  const organisationId = profile.organisation_id;

  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("risk_questionnaire_configs")
    .select("version")
    .eq("organisation_id", organisationId)
    .eq("code", QUESTIONNAIRE_CODE)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const { error } = await supabase.from("risk_questionnaire_configs").insert({
    organisation_id: organisationId,
    code: QUESTIONNAIRE_CODE,
    version: nextVersion,
    config: JSON.parse(parsed.data.configJson) as Json,
    notes: parsed.data.notes,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/risk-questionnaire-config");
  return { success: true };
}

/**
 * Sign and activate a risk questionnaire configuration. The DB RPC
 * (sign_risk_questionnaire_config) is the real gate — it only succeeds for
 * an active Clinical Director in the config's organisation, stamps
 * approved_by from the caller's own clinical_staff record, and deactivates
 * any prior active config for the same code. A signature cannot be forged
 * from the app layer.
 */
export async function signRiskQuestionnaireConfigAction(
  configId: string
): Promise<SignRiskQuestionnaireConfigState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_risk_questionnaire_config", { p_config_id: configId });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/risk-questionnaire-config");
  return { success: true };
}
