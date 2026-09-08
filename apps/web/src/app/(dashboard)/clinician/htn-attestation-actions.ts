"use server";

import { createClient } from "@/lib/supabase/server";

export type HtnAttestationState = { error?: string; success?: boolean } | undefined;

/** Must match the version string `private.enforce_htn_alert_attestation()`
 * checks via `private.has_current_pathway_attestation(staff, 'htn-red-flags-v1')`
 * (20260810031306_htn_red_flag_attestation_gate_at_acknowledgement.sql). */
const HTN_ATTESTATION_VERSION = "htn-red-flags-v1";

/**
 * A clinician signs the hypertension red-flag competency attestation
 * (H17, TH-CP-HTN-001 §14.7/§23) — required before `enforce_htn_alert_attestation`
 * (a DB trigger on `clinician_alerts`) will let them acknowledge a blood-pressure-
 * sourced alert. Same shape as the AHC attestation (`attestation-actions.ts`):
 * writes `clinical_staff_attestations`, resolved and RLS-scoped to the caller's
 * own `clinical_staff` row, +1 year expiry, re-signable annually.
 */
export async function signHtnAttestation(
  _prevState: HtnAttestationState,
  _formData: FormData,
): Promise<HtnAttestationState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id, organisation_id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) {
    return { error: "Only an active Tarragon care-team doctor can sign this attestation" };
  }

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const { error } = await supabase.from("clinical_staff_attestations").insert({
    organisation_id: staff.organisation_id,
    clinical_staff_id: staff.id,
    attestation_version: HTN_ATTESTATION_VERSION,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { error: error.message };

  return { success: true };
}
