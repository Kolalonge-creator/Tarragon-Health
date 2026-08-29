import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { InstitutionAggregateAccess } from "./aggregate-access";

export type WorkforceRiskEngagement = {
  id: string;
  organisation_id: string;
  employee_count: number;
  amount_minor: number;
  currency: string;
  status: string;
  window_start: string | null;
  window_end: string | null;
  invoiced_at: string | null;
  paid_at: string | null;
  completed_at: string | null;
  created_at: string;
};

/**
 * Loaded under the caller's OWN session (not the service-role aggregate
 * doorway) — engagement metadata is the employer's own commercial record
 * (employee_count/amount/status), not patient data, and
 * workforce_risk_engagements_employer_select already scopes it to their own
 * organisation. Superadmin sees every org's via the admin policy.
 */
export async function getWorkforceRiskEngagements(
  organisationId: string,
): Promise<WorkforceRiskEngagement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workforce_risk_engagements")
    .select("*")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type WorkforceRiskReport = {
  engagement: WorkforceRiskEngagement;
  /** Employees with a computed risk score inside the engagement's window. */
  participantCount: number;
  /** Of employee_count — how much of the commissioned workforce actually completed it. */
  participationRate: number;
  /** Risk-tier distribution, small-cell suppressed per tier the same way
   * the rest of the corporate dashboard suppresses a whole cohort — a tier
   * with a handful of people is still individual health data with a
   * percentage sign on it. */
  tierCounts: Record<"low" | "moderate" | "high" | "very_high" | "unknown", number> | null;
  /** Which conditions are actually concentrated in this workforce, ranked —
   * the plan's "the conditions concentrated in its workforce" line. */
  conditionCounts: { condition: string; count: number }[] | null;
  suppressed: boolean;
};

/**
 * E4's employer-facing report — reads private.is_org_staff-gated
 * prevention_risk_scores through the same service-role doorway every other
 * corporate aggregate uses (requireInstitutionAggregateAccess), scoped to
 * this ONE engagement's roster window rather than the whole org's ongoing
 * history the ordinary corporate dashboard shows. Caller must already hold
 * an `access` from requireInstitutionAggregateAccess for this engagement's
 * organisation_id — this function never re-derives authorisation itself, to
 * keep exactly one doorway into patient-scoped data for institutions (I9).
 */
export async function loadWorkforceRiskReport(
  access: InstitutionAggregateAccess,
  engagementId: string,
): Promise<WorkforceRiskReport | null> {
  const { data: engagement, error } = await access.client
    .from("workforce_risk_engagements")
    .select("*")
    .eq("id", engagementId)
    .eq("organisation_id", access.organisationId)
    .maybeSingle();
  if (error || !engagement) return null;

  if (!engagement.window_start) {
    // Not yet invoiced — no assessment window has opened, nothing to report.
    return {
      engagement,
      participantCount: 0,
      participationRate: 0,
      tierCounts: null,
      conditionCounts: null,
      suppressed: false,
    };
  }

  let query = access.client
    .from("prevention_risk_scores")
    .select("profile_id, tier, condition")
    .eq("organisation_id", access.organisationId)
    .gte("computed_at", engagement.window_start);
  if (engagement.window_end) {
    query = query.lte("computed_at", engagement.window_end);
  }
  const { data: scores } = await query;
  const rows = scores ?? [];

  const participantIds = new Set(rows.map((r) => r.profile_id));
  const participantCount = participantIds.size;
  const suppressed = participantCount > 0 && participantCount < access.minCohortSize;

  if (participantCount === 0 || suppressed) {
    return {
      engagement,
      participantCount,
      participationRate: engagement.employee_count > 0 ? participantCount / engagement.employee_count : 0,
      tierCounts: null,
      conditionCounts: null,
      suppressed,
    };
  }

  const tierCounts: WorkforceRiskReport["tierCounts"] = {
    low: 0,
    moderate: 0,
    high: 0,
    very_high: 0,
    unknown: 0,
  };
  const conditionTally = new Map<string, number>();
  // One score per profile per condition may exist multiple times (re-scored
  // over the window) — count the LATEST tier per (profile, condition), not
  // every historical row, so someone re-assessed twice doesn't double-count.
  const latestByProfileCondition = new Map<string, string>();
  for (const row of rows) {
    latestByProfileCondition.set(`${row.profile_id}:${row.condition}`, row.tier);
  }
  for (const tier of latestByProfileCondition.values()) {
    if (tier in tierCounts) {
      tierCounts[tier as keyof typeof tierCounts] += 1;
    }
  }
  for (const key of latestByProfileCondition.keys()) {
    const condition = key.split(":")[1];
    conditionTally.set(condition, (conditionTally.get(condition) ?? 0) + 1);
  }

  const conditionCounts = Array.from(conditionTally.entries())
    // Small-cell suppression applies per condition too.
    .filter(([, count]) => count >= access.minCohortSize)
    .map(([condition, count]) => ({ condition, count }))
    .sort((a, b) => b.count - a.count);

  return {
    engagement,
    participantCount,
    participationRate: engagement.employee_count > 0 ? participantCount / engagement.employee_count : 0,
    tierCounts,
    conditionCounts,
    suppressed: false,
  };
}
