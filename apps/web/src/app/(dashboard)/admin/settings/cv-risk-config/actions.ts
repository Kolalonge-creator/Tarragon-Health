"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import {
  cvRiskConfigFormSchema,
  buildCvRiskConfig,
} from "@/lib/validation/cv-risk-config";
import type { Json } from "@tarragon/shared";

export type SignCvRiskConfigState = { error?: string; success?: boolean } | undefined;
export type SaveCvRiskConfigState = { error?: string; success?: boolean } | undefined;

/**
 * Create a NEW version of the CV-risk configuration from edited values. It is
 * inserted as an unsigned, inactive draft (RLS forces approved_by null /
 * is_active false); a Clinical Director then signs it to bring it into force.
 * Editing never mutates a signed version — every change is a new version, so
 * the audit trail of what was in force when stays intact.
 */
export async function createCvRiskConfigDraftAction(
  _prev: SaveCvRiskConfigState,
  formData: FormData
): Promise<SaveCvRiskConfigState> {
  const parsed = cvRiskConfigFormSchema.safeParse(Object.fromEntries(formData.entries()));
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
    .from("cv_risk_config")
    .select("version")
    .eq("organisation_id", organisationId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const config = buildCvRiskConfig(parsed.data);
  const { error } = await supabase.from("cv_risk_config").insert({
    organisation_id: organisationId,
    version: nextVersion,
    config: config as unknown as Json,
    notes: `Edited by admin — version ${nextVersion}. Review and sign to bring into force.`,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/cv-risk-config");
  return { success: true };
}

/**
 * Sign and activate a CV-risk configuration. The DB RPC
 * (sign_cv_risk_config) is the real gate — it only succeeds for an active
 * Clinical Director in the config's organisation, stamps approved_by from the
 * caller's own clinical_staff record, and deactivates any prior active config.
 * A signature cannot be forged from the app layer.
 */
export async function signCvRiskConfigAction(
  configId: string
): Promise<SignCvRiskConfigState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_cv_risk_config", { p_config_id: configId });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/cv-risk-config");
  return { success: true };
}
