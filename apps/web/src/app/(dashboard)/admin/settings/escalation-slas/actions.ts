"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type CreateEscalationSlaDraftState = { error?: string; success?: boolean } | undefined;
export type SignEscalationSlasState = { error?: string; success?: boolean } | undefined;

/**
 * Create a new draft version, duplicating the CURRENTLY ACTIVE config
 * verbatim so the record shows exactly what was in force at the moment the
 * draft was opened. This page never edits SLA numbers directly — a numeric
 * change is a clinical-safety decision that belongs in a reviewed, tested
 * migration (see supabase/migrations/*escalation_sla_config.sql); this
 * action exists only so a Director can re-attest an unchanged config, or so
 * an admin can open a draft immediately after a migration changes the
 * numbers, ready for the Director to review and sign.
 */
export async function createEscalationSlaDraftAction(
  _prev: CreateEscalationSlaDraftState,
  formData: FormData
): Promise<CreateEscalationSlaDraftState> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { data: active, error: activeError } = await supabase
    .from("escalation_slas")
    .select("config")
    .eq("is_active", true)
    .maybeSingle();
  if (activeError) return { error: activeError.message };
  if (!active) return { error: "No active escalation SLA config found to draft from." };

  const { data: latest } = await supabase
    .from("escalation_slas")
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const notes =
    String(formData.get("notes") ?? "").trim() ||
    `Re-attested by admin — version ${nextVersion}, config unchanged from the prior active version. Sign to bring into force.`;

  const { error } = await supabase.from("escalation_slas").insert({
    version: nextVersion,
    config: active.config,
    notes,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/settings/escalation-slas");
  return { success: true };
}

/**
 * Sign and activate an escalation_slas version. The DB RPC
 * (sign_escalation_slas) is the real gate — it only succeeds for an active
 * Clinical Director, stamps approved_by from the caller's own clinical_staff
 * record, and deactivates any prior active version. A signature cannot be
 * forged from the app layer.
 */
export async function signEscalationSlasAction(
  versionId: string
): Promise<SignEscalationSlasState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_escalation_slas", {
    p_id: versionId,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/settings/escalation-slas");
  return { success: true };
}
