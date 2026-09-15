"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type CreateAlertRulesDraftState = { error?: string; success?: boolean } | undefined;
export type SignAlertRulesState = { error?: string; success?: boolean } | undefined;

const REVALIDATE_PATH = "/admin/settings/alert-rules";

/**
 * Create a new draft version, duplicating the most recent version's config
 * verbatim — mirrors createTriageProtocolDraftAction/
 * createEscalationSlaDraftAction. This page never edits the alert taxonomy
 * (severity, owner tier, ack timeout) directly: adding or changing an alert
 * type is a clinical-governance decision that belongs in a reviewed,
 * tested migration; this action exists so a Director can re-attest an
 * unchanged config, or open a draft immediately after a migration changes
 * it, ready to sign.
 */
export async function createAlertRulesDraftAction(
  _prev: CreateAlertRulesDraftState,
  formData: FormData
): Promise<CreateAlertRulesDraftState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { data: latest, error: latestError } = await supabase
    .from("alert_rules")
    .select("version, config")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return { error: latestError.message };
  if (!latest) return { error: "No existing alert_rules version found to draft from." };

  const nextVersion = latest.version + 1;
  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Re-attested by admin, version ${nextVersion}, config unchanged from version ${latest.version}. Sign to bring into force.`;

  const { error } = await supabase.from("alert_rules").insert({
    version: nextVersion,
    config: latest.config,
    notes,
  });
  if (error) return { error: error.message };

  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}

/**
 * Sign and activate an alert_rules version. The DB RPC (sign_alert_rules)
 * is the real gate — it only succeeds for an active Clinical Director,
 * stamps approved_by from the caller's own clinical_staff record, and
 * deactivates any prior active version. A signature cannot be forged from
 * the app layer.
 */
export async function signAlertRulesAction(versionId: string): Promise<SignAlertRulesState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_alert_rules", { p_id: versionId });
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE_PATH);
  return { success: true };
}
