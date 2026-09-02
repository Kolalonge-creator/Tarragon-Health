"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ClinicalRuleActionState = { error?: string; success?: string } | undefined;

const REVALIDATE_PATH = "/admin/settings/clinical-rules";

/**
 * §32.13. The DB RPC (public.promote_clinical_rule_to_shadow) is the real
 * gate -- admin-only, only from `draft`. See that function's comment for
 * why this is admin-gated rather than Clinical-Director-gated: a shadow
 * rule cannot reach a patient, so requiring a signature just to start
 * measuring one would discourage the shadow step §32.13 exists for.
 */
export async function promoteToShadowAction(
  _prev: ClinicalRuleActionState,
  formData: FormData
): Promise<ClinicalRuleActionState> {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const { error } = await supabase.rpc("promote_clinical_rule_to_shadow", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE_PATH);
  return { success: "Promoted to shadow. It will now be evaluated against real events without acting on any patient." };
}

/**
 * §32.16 governed activation. public.sign_clinical_rule is Clinical-
 * Director-gated and refuses a rule with no protocol_version_id or no
 * accountable owner -- this action just surfaces whatever it returns.
 */
export async function signClinicalRuleAction(
  _prev: ClinicalRuleActionState,
  formData: FormData
): Promise<ClinicalRuleActionState> {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const activate = formData.get("activate") !== "false";
  const { error } = await supabase.rpc("sign_clinical_rule", { p_id: id, p_activate: activate });
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE_PATH);
  return { success: activate ? "Signed and activated." : "Signed (not yet activated)." };
}

/** §32.15 rollback. Clinical-Director-gated; refuses to roll back to an unsigned version. */
export async function rollbackClinicalRuleAction(
  _prev: ClinicalRuleActionState,
  formData: FormData
): Promise<ClinicalRuleActionState> {
  const supabase = await createClient();
  const ruleKey = String(formData.get("rule_key"));
  const toVersion = Number(formData.get("to_version"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A rollback reason is required." };

  const { error } = await supabase.rpc("rollback_clinical_rule", {
    p_rule_key: ruleKey,
    p_to_version: toVersion,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE_PATH);
  return { success: `Rolled back to version ${toVersion}.` };
}

export async function retireClinicalRuleAction(
  _prev: ClinicalRuleActionState,
  formData: FormData
): Promise<ClinicalRuleActionState> {
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A retirement reason is required." };

  const { error } = await supabase.rpc("retire_clinical_rule", { p_id: id, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath(REVALIDATE_PATH);
  return { success: "Retired." };
}

export type ShadowReportState =
  | { error: string; report?: undefined }
  | { error?: undefined; report: Record<string, unknown> }
  | undefined;

/** §32.13 shadow readout, fetched on demand rather than for every rule up front (each call scans the execution ledger). */
export async function fetchShadowReportAction(
  _prev: ShadowReportState,
  formData: FormData
): Promise<ShadowReportState> {
  const supabase = await createClient();
  const ruleKey = String(formData.get("rule_key"));
  const { data, error } = await supabase.rpc("clinical_rule_shadow_report", { p_rule_key: ruleKey });
  if (error) return { error: error.message };
  return { report: data as Record<string, unknown> };
}
