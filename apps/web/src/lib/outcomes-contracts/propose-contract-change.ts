"use server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@tarragon/shared";

export type ProposeContractChangeState = { error?: string; message?: string } | undefined;

const KNOWN_METRIC_LABELS: Record<string, string> = {
  screening_compliance_percent: "Screening compliance",
  bp_control_percent: "Average BP control",
};

/**
 * Org-facing entry point for public.propose_outcomes_contract_change() —
 * the RPC itself re-checks the caller is hmo_admin/corporate_admin for this
 * exact organisation, so this action does no authorisation of its own; it
 * only shapes the form input into the RPC's expected jsonb array.
 */
export async function proposeContractChange(
  organisationId: string,
  _prevState: ProposeContractChangeState,
  formData: FormData
): Promise<ProposeContractChangeState> {
  const supabase = await createClient();

  const contractType = formData.get("contractType");
  if (typeof contractType !== "string" || !["fee_at_risk", "flat"].includes(contractType)) {
    return { error: "Choose a contract type" };
  }
  const payoutTerms = formData.get("payoutTerms");
  const effectiveFrom = formData.get("effectiveFrom");

  const thresholds: { metric: string; label: string; target: number; better_when: "higher" | "lower" }[] = [];
  for (const metric of Object.keys(KNOWN_METRIC_LABELS)) {
    const targetRaw = formData.get(`target_${metric}`);
    if (typeof targetRaw === "string" && targetRaw.trim()) {
      const target = Number(targetRaw);
      if (Number.isFinite(target)) {
        thresholds.push({ metric, label: KNOWN_METRIC_LABELS[metric], target, better_when: "higher" });
      }
    }
  }

  const { error } = await supabase.rpc("propose_outcomes_contract_change", {
    p_organisation_id: organisationId,
    p_contract_type: contractType as Database["public"]["Enums"]["outcomes_contract_type"],
    p_outcome_thresholds: thresholds,
    p_payout_terms: typeof payoutTerms === "string" && payoutTerms.trim() ? payoutTerms.trim() : "",
    p_effective_from: typeof effectiveFrom === "string" && effectiveFrom ? effectiveFrom : undefined,
  });

  if (error) return { error: error.message };
  return { message: "Sent for review — you'll see it here once a superadmin approves or rejects it." };
}
