"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SignClinicalConfigState = { error?: string; success?: boolean } | undefined;

/**
 * Record that the CMO opened the source documents for a draft. The RPC is the gate (CMO only, drafts
 * only, note required) and records who, when and the note; this only trims the note for the form.
 */
export async function confirmClinicalConfigSourcesAction(versionId: string, note: string): Promise<SignClinicalConfigState> {
  const trimmed = note.trim();
  if (!trimmed) return { error: "Say which source documents you opened." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_clinical_config_sources", { p_id: versionId, p_note: trimmed });
  if (error) return { error: error.message };
  revalidatePath("/clinician/clinical-signoff");
  revalidatePath("/admin/settings/clinical-signoff");
  return { success: true };
}

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
