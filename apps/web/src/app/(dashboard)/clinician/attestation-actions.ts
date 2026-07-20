"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type AttestationState = { error?: string; success?: boolean } | undefined;

/**
 * A doctor attests they know and will act on the diabetes red flags (§25).
 * Stamps red_flag_attested_at on THEIR OWN clinical_staff row — the row is
 * resolved server-side from auth.uid() (never client-supplied) and written with
 * the service-role client after that ownership check, so a doctor can only ever
 * attest for themselves. Re-attest annually.
 */
export async function attestRedFlags(): Promise<AttestationState> {
import { createClient } from "@/lib/supabase/server";

export type SignAttestationState = { error?: string; success?: boolean } | undefined;

/** The current attestation text a doctor signs — kept in sync with the
 * migration's default `attestation_version`. Module-local: a "use server"
 * module may only export async functions, so this cannot be exported. */
const ATTESTATION_VERSION = "AHC-2026-v1";

/**
 * Records the caller's annual red-flag attestation (AHC pathway §26). The
 * doctor signs that they will practise evidence-based, high-value screening,
 * deliver sensitive results personally, act on every red flag (§18), and
 * never leave an abnormal result without a closed-loop plan.
 *
 * Self-attestation: only an active clinical_staff member may sign, and only
 * for their own record (RLS enforces the ownership; this resolves the row).
 * Append-only — a new row each time, so re-signing next year is a new record.
 */
export async function signAttestation(
  _prevState: SignAttestationState,
  _formData: FormData
): Promise<SignAttestationState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) return { error: "No active care-team record for your account" };

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await createServiceRoleClient()
    .from("clinical_staff")
    .update({ red_flag_attested_at: today })
    .eq("id", staff.id);
  if (error) return { error: error.message };

  revalidatePath("/clinician");
    .select("id, organisation_id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) {
    return { error: "Only an active Tarragon care-team doctor can sign this attestation" };
  }

  const { error } = await supabase.from("clinical_staff_attestations").insert({
    organisation_id: staff.organisation_id,
    clinical_staff_id: staff.id,
    attestation_version: ATTESTATION_VERSION,
    // expires_at defaulted by the set_attestation_expiry trigger (+1 year).
  });
  if (error) return { error: error.message };

  return { success: true };
}
