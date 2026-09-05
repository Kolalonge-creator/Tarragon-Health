"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import type { Json } from "@tarragon/shared";
import { slaFieldName } from "./sla-field";

/** One row of the escalation_slas JSON config. Indexed by string so it round-
 * trips through the Json column type without losing the fields this action
 * does not touch. */
interface SlaConfigEntry {
  tier: string;
  pathway: string;
  sla_minutes: number;
  [key: string]: Json[keyof Json] | string | number | undefined;
}

export type CreateEscalationSlaDraftState = { error?: string; success?: boolean } | undefined;
export type SignEscalationSlasState = { error?: string; success?: boolean } | undefined;

/**
 * Create a new draft version from the CURRENTLY ACTIVE config, optionally
 * with edited SLA minutes.
 *
 * This used to refuse numeric edits outright, on the reasoning that changing
 * an SLA is a clinical-safety decision belonging in a reviewed migration.
 * The intent was right but the instrument was wrong: escalation_slas exists
 * precisely so these numbers can change WITHOUT a deployment, and requiring
 * a migration to alter one number meant the config drifted from what anyone
 * had actually reviewed (v5 sat active and unsigned, carrying entries whose
 * own notes said "DRAFT, needs Clinical Director sign-off").
 *
 * The safety property is preserved where it actually lives: an edit never
 * touches the active config. It writes a NEW, unsigned, inactive version,
 * and nothing comes into force until a Clinical Director signs it through
 * public.sign_escalation_slas — which stamps approved_by from their own
 * clinical_staff record and deactivates the prior version. So a number can
 * now be changed in the app, but it still cannot take effect without a
 * signature, and the version history shows exactly what changed and who
 * approved it.
 *
 * Edits arrive as `sla__<tier>__<pathway>` form fields holding minutes. Any
 * entry with no matching field is carried through byte-for-byte.
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

  // Apply any edited minutes onto a copy of the active config.
  const entries = Array.isArray(active.config)
    ? (active.config as SlaConfigEntry[])
    : [];
  const changes: string[] = [];
  const nextConfig = entries.map((entry) => {
    const field = formData.get(slaFieldName(entry.tier, entry.pathway));
    if (field === null) return entry;
    const parsed = Number(String(field).trim());
    // A blank, non-numeric or unchanged field is not an edit. Rejecting
    // silently would be worse than ignoring: the draft would claim a change
    // it did not make.
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed === entry.sla_minutes) {
      return entry;
    }
    changes.push(
      `${entry.tier}/${entry.pathway} ${entry.sla_minutes} -> ${parsed} min`
    );
    return { ...entry, sla_minutes: parsed };
  });

  const notes =
    String(formData.get("notes") ?? "").trim() ||
    (changes.length > 0
      ? `Version ${nextVersion}: ${changes.join("; ")}. Sign to bring into force.`
      : `Re-attested by admin, version ${nextVersion}, config unchanged from the prior active version. Sign to bring into force.`);

  const { error } = await supabase.from("escalation_slas").insert({
    version: nextVersion,
    config: nextConfig as unknown as Json,
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
