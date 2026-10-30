import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Counts of the payer's own work queues, read for the home page.
 *
 * Each count is null when its read failed: unknown, never zero. The statuses
 * match what the pre-authorisations and claims pages act on:
 *   - a pre-authorisation with status "pending" waits for a decision
 *   - a claim "submitted" or "adjudicating" waits to be adjudicated
 *   - a claim "approved" or "partially_approved" waits to be marked paid
 *
 * Unlike the list pages, the insurer is matched with an inner join, so the
 * count is scoped to the selected insurer even for a login that can see more
 * than one (the lists rely on row security alone for that).
 */

export interface PayerQueueCounts {
  preauthPending: number | null;
  claimsToAdjudicate: number | null;
  claimsToPay: number | null;
}

type CountReply = { count: number | null; error: unknown };

function countOrNull(reply: CountReply): number | null {
  return reply.error || typeof reply.count !== "number" ? null : reply.count;
}

export async function readPayerQueueCounts(
  supabase: SupabaseClient,
  insurerId: string,
): Promise<PayerQueueCounts> {
  const preauths = () =>
    supabase
      .from("insurance_preauthorizations")
      .select("id, insurance_policies!inner(insurer_id)", { count: "exact", head: true })
      .eq("insurance_policies.insurer_id", insurerId);
  const claims = () =>
    supabase
      .from("insurance_claims")
      .select("id, insurance_policies!inner(insurer_id)", { count: "exact", head: true })
      .eq("insurance_policies.insurer_id", insurerId);

  const [pending, toAdjudicate, toPay] = await Promise.all([
    preauths().eq("status", "pending"),
    claims().in("status", ["submitted", "adjudicating"]),
    claims().in("status", ["approved", "partially_approved"]),
  ]);

  return {
    preauthPending: countOrNull(pending),
    claimsToAdjudicate: countOrNull(toAdjudicate),
    claimsToPay: countOrNull(toPay),
  };
}
