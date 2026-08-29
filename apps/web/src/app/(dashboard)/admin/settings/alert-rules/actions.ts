"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type CreateAlertRulesDraftState = { error?: string; success?: boolean } | undefined;
export type SignAlertRulesState = { error?: string; success?: boolean } | undefined;

/**
 * Governance sign-off for `alert_rules` (20260828013011) — the Alert
 * System's routing/ownership/timeout policy per alert_type_code (spec
 * §31.13's "who receives the alert, response timeframe, backup person,
 * escalation route, maximum delay"). Shipped active-but-unsigned, same
 * posture as escalation_slas v1: alert generation reads it unconditionally
 * (private.alert_rule_config fails open on no active config) and is never
 * blocked on a Director's signature — this page is where that signature
 * gets put on file, mirroring admin/settings/escalation-slas/actions.ts
 * exactly.
 *
 * Like escalation-slas, this page never edits the config's numbers
 * directly — a routing/timeout change is a clinical-safety decision that
 * belongs in a reviewed, tested migration.
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
  const { data: active, error: activeError } = await supabase
    .from("alert_rules")
    .select("config")
    .eq("is_active", true)
    .maybeSingle();
  if (activeError) return { error: activeError.message };
  if (!active) return { error: "No active alert rules config found to draft from." };

  const { data: latest } = await supabase
    .from("alert_rules")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Re-attested by admin, version ${nextVersion}, config unchanged from the prior active version. Sign to bring into force.`;

  const { error } = await supabase.from("alert_rules").insert({
    version: nextVersion,
    config: active.config,
    notes,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/alert-rules");
  return { success: true };
}

/**
 * Sign and activate an alert_rules version. public.sign_alert_rules is the
 * real gate — only an active Clinical Director may call it; it stamps
 * approved_by from the caller's own clinical_staff record and retires any
 * other active version. A signature cannot be forged from the app layer.
 */
export async function signAlertRulesAction(versionId: string): Promise<SignAlertRulesState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_alert_rules", { p_id: versionId });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/alert-rules");
  return { success: true };
}
