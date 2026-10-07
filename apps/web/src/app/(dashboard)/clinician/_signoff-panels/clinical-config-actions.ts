"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SignClinicalConfigState = { error?: string; success?: boolean } | undefined;

/**
 * Sign a clinical config version. The database RPC is the real gate: the active Chief Medical Officer
 * only, no older version than one signed, and an approved independent review of this exact version for
 * a high-risk kind. Nothing is checked twice here on purpose, so the two cannot disagree; the panel
 * only hides the button and says why.
 */
export async function signClinicalConfigVersionAction(versionId: string): Promise<SignClinicalConfigState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_clinical_config_version", { p_id: versionId });
  if (error) return { error: error.message };
  revalidatePath("/clinician/clinical-signoff");
  revalidatePath("/admin/settings/clinical-signoff");
  return { success: true };
}
