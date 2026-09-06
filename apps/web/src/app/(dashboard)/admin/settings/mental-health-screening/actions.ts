"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type CreateScreeningCadenceDraftState = { error?: string; success?: boolean } | undefined;
export type SignScreeningCadenceState = { error?: string; success?: boolean } | undefined;

const REVALIDATE_PATH = "/admin/settings/mental-health-screening";

/**
 * Create a new draft version, duplicating the most recent version's
 * cadences verbatim — mirrors createTriageProtocolDraftAction. A cadence
 * change (how often PHQ-9/GAD-7/AUDIT-C repeat, and the follow-up interval
 * after a concern band) is a clinical-governance decision that belongs in a
 * reviewed, tested migration; this action exists so a Director can
 * re-attest an unchanged config, or open a draft immediately after a
 * migration changes it, ready to sign.
 */
export async function createScreeningCadenceDraftAction(
  _prev: CreateScreeningCadenceDraftState,
  formData: FormData
): Promise<CreateScreeningCadenceDraftState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { data: latest, error: latestError } = await supabase
    .from("mental_health_screening_cadences")
    .select("version, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { error: latestError.message };
  if (!latest) return { error: "No existing mental_health_screening_cadences version found to draft from." };

  const nextVersion = latest.version + 1;
  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Re-attested by admin, version ${nextVersion}, config unchanged from version ${latest.version}. Sign to bring into force.`;

  const { error } = await supabase.from("mental_health_screening_cadences").insert({
    version: nextVersion,
    config: latest.config,
    notes,
  });
  if (error) return { error: error.message };

  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}

/**
 * Sign and activate a mental_health_screening_cadences version. The DB RPC
 * (sign_mental_health_screening_cadences) is the real gate — it only
 * succeeds for an active Clinical Director, stamps approved_by from the
 * caller's own clinical_staff record, and deactivates any prior active
 * version. A signature cannot be forged from the app layer.
 */
export async function signScreeningCadenceAction(versionId: string): Promise<SignScreeningCadenceState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_mental_health_screening_cadences", { p_id: versionId });
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}
