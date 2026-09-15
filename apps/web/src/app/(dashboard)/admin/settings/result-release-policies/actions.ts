"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type CreateResultReleasePolicyDraftState = { error?: string; success?: boolean } | undefined;
export type SignResultReleasePoliciesState = { error?: string; success?: boolean } | undefined;

/**
 * Create a new draft version, duplicating the CURRENTLY ACTIVE config
 * verbatim — same reasoning as escalation-slas' own draft action. This page
 * never edits which screen types are restricted directly; that's a
 * clinical-safety decision that belongs in a reviewed, tested migration
 * (see supabase/migrations/20260829135012_result_release_policies.sql).
 * This action exists so a Director can re-attest an unchanged config, or so
 * an admin can open a draft after a migration changes it, ready to sign.
 */
export async function createResultReleasePolicyDraftAction(
  _prev: CreateResultReleasePolicyDraftState,
  formData: FormData
): Promise<CreateResultReleasePolicyDraftState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { data: active, error: activeError } = await supabase
    .from("result_release_policies")
    .select("config")
    .eq("is_active", true)
    .maybeSingle();
  if (activeError) return { error: activeError.message };
  if (!active) return { error: "No active result release policy found to draft from." };

  const { data: latest } = await supabase
    .from("result_release_policies")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Re-attested by admin, version ${nextVersion}, config unchanged from the prior active version. Sign to bring into force.`;

  const { error } = await supabase.from("result_release_policies").insert({
    version: nextVersion,
    config: active.config,
    notes,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/result-release-policies");
  return { success: true };
}

/**
 * Sign and activate a result_release_policies version. The DB RPC
 * (sign_result_release_policies) is the real gate — only an active
 * Clinical Director, stamped from the caller's own clinical_staff record.
 */
export async function signResultReleasePoliciesAction(
  versionId: string
): Promise<SignResultReleasePoliciesState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_result_release_policies", {
    p_id: versionId,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/result-release-policies");
  return { success: true };
}
