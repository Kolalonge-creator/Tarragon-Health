import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { anyQueryFailed } from "@/lib/queries/server-query-state";

export type PendingAiGovernanceSignoff = {
  pendingVersionApprovalCount: number;
  pendingClinicalAccuracyLabelCount: number;
  /** Total of the two counts above — what a banner/badge should show. */
  attentionCount: number;
  /** A read failed, so `attentionCount` understates reality — never render it as an all-clear. */
  failed: boolean;
};

/**
 * The two pieces of AI governance work that only an active Chief Medical
 * Officer can close — an `ai_system_versions` row awaiting
 * `approve_ai_system_version`, or an `ai_evaluation_cases` clinical-accuracy
 * scenario awaiting `label_ai_evaluation_case_tier` — shared by the admin
 * welcome banner and the clinician-reachable equivalent so the two counts
 * can never drift apart.
 *
 * Extracted from admin/page.tsx's pre-existing inline queries (no behaviour
 * change there). Before this, the only place either count was ever surfaced
 * was that admin welcome banner, itself only reachable at `/admin` — and a
 * real Chief Medical Officer's account is always `profiles.role =
 * 'clinician'` (see CLAUDE.md's "never re-split the account role" rule), so
 * proxy.ts's `/admin/*` gate gave them no way to even see this work exists,
 * let alone act on it, absent an explicit delegated permission grant. Same
 * failure mode `read-clinical-signoff-checklist.ts` closed for the 8
 * GOVERNED_CONFIG_TABLES on 2026-09-22 — this closes it for AI governance.
 */
export async function readPendingAiGovernanceSignoff(
  supabase: SupabaseClient<Database>
): Promise<PendingAiGovernanceSignoff> {
  const [versionsRes, casesRes] = await Promise.all([
    supabase
      .from("ai_system_versions")
      .select("*", { count: "exact", head: true })
      .is("approved_at", null)
      .is("retired_at", null),
    supabase
      .from("ai_evaluation_cases")
      .select("*, ai_evaluation_suites!inner(kind)", { count: "exact", head: true })
      .eq("ai_evaluation_suites.kind", "clinical")
      .is("expected_tier", null),
  ]);

  const failed = anyQueryFailed([versionsRes, casesRes]);
  const pendingVersionApprovalCount = versionsRes.count ?? 0;
  const pendingClinicalAccuracyLabelCount = casesRes.count ?? 0;

  return {
    pendingVersionApprovalCount,
    pendingClinicalAccuracyLabelCount,
    attentionCount: pendingVersionApprovalCount + pendingClinicalAccuracyLabelCount,
    failed,
  };
}
