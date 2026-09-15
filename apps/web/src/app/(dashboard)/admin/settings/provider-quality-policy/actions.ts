"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type CreateProviderQualityPolicyDraftState = { error?: string; success?: boolean } | undefined;
export type SignProviderQualityPolicyState = { error?: string; success?: boolean } | undefined;

const REVALIDATE_PATH = "/admin/settings/provider-quality-policy";

/**
 * Create a new draft version, duplicating the most recent version's config
 * verbatim — mirrors createTriageProtocolDraftAction. A metric target,
 * warning band, or credential-ladder timing change belongs in a reviewed,
 * tested migration; this action exists so a Director can re-attest an
 * unchanged config, or open a draft immediately after a migration changes
 * it, ready to sign.
 */
export async function createProviderQualityPolicyDraftAction(
  _prev: CreateProviderQualityPolicyDraftState,
  formData: FormData
): Promise<CreateProviderQualityPolicyDraftState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { data: latest, error: latestError } = await supabase
    .from("provider_quality_policy")
    .select("version, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { error: latestError.message };
  if (!latest) return { error: "No existing provider_quality_policy version found to draft from." };

  const nextVersion = latest.version + 1;
  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Re-attested by admin, version ${nextVersion}, config unchanged from version ${latest.version}. Sign to bring into force.`;

  const { error } = await supabase.from("provider_quality_policy").insert({
    version: nextVersion,
    config: latest.config,
    notes,
  });
  if (error) return { error: error.message };

  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}

/**
 * Sign and activate a provider_quality_policy version. The DB RPC
 * (sign_provider_quality_policy) is the real gate — it only succeeds for an
 * active Clinical Director, stamps approved_by from the caller's own
 * clinical_staff record, and deactivates any prior active version. A
 * signature cannot be forged from the app layer.
 */
export async function signProviderQualityPolicyAction(policyId: string): Promise<SignProviderQualityPolicyState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_provider_quality_policy", { p_policy_id: policyId });
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}
