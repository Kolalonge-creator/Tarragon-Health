"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import type { Json } from "@tarragon/shared";

export type CreateTrialState = { error?: string; success?: boolean } | undefined;
export type AttestEthicsState = { error?: string; success?: boolean } | undefined;
export type MatchingPreviewState =
  | { error?: string; result?: Record<string, unknown> }
  | undefined;

/**
 * Trial creation defaults eligibility_rule to {"op":"false"} at the DB level
 * (matches nobody) if the field is left blank — a draft trial should never
 * accidentally match real patients before anyone has written its criteria.
 */
export async function createClinicalTrialAction(
  _prev: CreateTrialState,
  formData: FormData
): Promise<CreateTrialState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin" || !profile.organisation_id) {
    return { error: "Not authorised" };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required" };

  const eligibilityJson = String(formData.get("eligibility_rule_json") ?? "").trim();
  let eligibilityRule: Json = { op: "false" };
  if (eligibilityJson) {
    try {
      eligibilityRule = JSON.parse(eligibilityJson) as Json;
    } catch {
      return { error: "Eligibility rule must be valid JSON" };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("clinical_trials").insert({
    organisation_id: profile.organisation_id,
    name,
    sponsor: String(formData.get("sponsor") ?? "").trim() || null,
    protocol_reference: String(formData.get("protocol_reference") ?? "").trim() || null,
    eligibility_rule: eligibilityRule,
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/clinical-trials-matching");
  return { success: true };
}

/**
 * The DB RPC is the real gate — it only succeeds for private.is_admin() and
 * stamps ethics_attested_by server-side from the caller's own session.
 * Unchecking "approved" clears ethics_approved_at (e.g. approval lapsed).
 */
export async function attestEthicsApprovalAction(
  _prev: AttestEthicsState,
  formData: FormData
): Promise<AttestEthicsState> {
  const trialId = String(formData.get("trial_id") ?? "");
  const approved = formData.get("approved") === "true";
  const committee = String(formData.get("ethics_committee_name") ?? "").trim() || undefined;
  const reference = String(formData.get("ethics_reference") ?? "").trim() || undefined;

  const supabase = await createClient();
  const { error } = await supabase.rpc("attest_clinical_trial_ethics_approval", {
    p_trial_id: trialId,
    p_approved: approved,
    p_ethics_committee_name: committee,
    p_ethics_reference: reference,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/clinical-trials-matching");
  return { success: true };
}

/**
 * Count-only — the RPC itself never returns patient identities (see its own
 * comment), so there is nothing further to redact here.
 */
export async function runMatchingPreviewAction(
  _prev: MatchingPreviewState,
  formData: FormData
): Promise<MatchingPreviewState> {
  const trialId = String(formData.get("trial_id") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clinical_trial_matching_preview", {
    p_trial_id: trialId,
  });
  if (error) return { error: error.message };
  return { result: data as Record<string, unknown> };
}
