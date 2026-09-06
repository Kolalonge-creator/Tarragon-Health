"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type CreateTriageProtocolDraftState = { error?: string; success?: boolean } | undefined;
export type SignTriageProtocolsState = { error?: string; success?: boolean } | undefined;

/**
 * Create a new draft version, duplicating the most recent version's config
 * verbatim — mirrors createEscalationSlaDraftAction exactly. This page
 * never edits pathway/red-flag content directly: a change to red-flag
 * thresholds or questionnaire branching is a clinical-safety decision that
 * belongs in a reviewed, tested migration
 * (supabase/migrations/*_symptom_triage_protocols_config.sql); this action
 * exists so a Director can re-attest an unchanged config, or open a draft
 * immediately after a migration changes it, ready to sign.
 */
export async function createTriageProtocolDraftAction(
  _prev: CreateTriageProtocolDraftState,
  formData: FormData
): Promise<CreateTriageProtocolDraftState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { data: latest, error: latestError } = await supabase
    .from("triage_protocols")
    .select("version, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { error: latestError.message };
  if (!latest) return { error: "No existing triage_protocols version found to draft from." };

  const nextVersion = latest.version + 1;
  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Re-attested by admin, version ${nextVersion}, config unchanged from version ${latest.version}. Sign to bring into force.`;

  const { error } = await supabase.from("triage_protocols").insert({
    version: nextVersion,
    config: latest.config,
    notes,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/triage-protocols");
  return { success: true };
}

/**
 * Sign and activate a triage_protocols version. The DB RPC
 * (sign_triage_protocols) is the real gate — it only succeeds for an active
 * Clinical Director, stamps approved_by from the caller's own clinical_staff
 * record, and deactivates any prior active version. A signature cannot be
 * forged from the app layer. Signing is also what turns the patient-facing
 * symptom checker on — see triage_protocols migration's fail-closed note.
 */
export async function signTriageProtocolsAction(versionId: string): Promise<SignTriageProtocolsState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_triage_protocols", {
    p_id: versionId,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/triage-protocols");
  revalidatePath("/patient");
  return { success: true };
}
