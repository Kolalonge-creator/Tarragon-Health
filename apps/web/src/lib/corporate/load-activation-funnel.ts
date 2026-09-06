import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { isCohortSuppressed } from "@/lib/institutions/suppression";

export type ActivationFunnel = {
  eligible: number;
  activated: number;
  engaged: number;
  healthAssessmentPct: number | null;
  preventiveCompletionPct: number | null;
};

export type DepartmentBreakdownRow = {
  departmentId: string | null;
  departmentName: string;
  eligible: number;
  activated: number;
  suppressed: boolean;
};

const ENGAGEMENT_WINDOW_DAYS = 90;

/**
 * Module 26 §26.8 (activation funnel) / §26.9 (small-cell suppression by
 * segment). Runs on the same service-role client requireInstitutionAggregateAccess
 * hands the corporate dashboard — this function never touches an
 * institution-admin session directly, and every count it returns is exactly
 * that: a count, never a per-member list. `engaged` and the two percentages
 * read patient-scoped tables (vitals/screening/risk activity), which is why
 * this needs the aggregate doorway at all — eligible/activated alone could
 * come straight off employer_roster_members, which an institution admin can
 * already read directly.
 */
export async function loadActivationFunnel(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  minCohortSize: number
): Promise<ActivationFunnel | null> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: roster } = await supabase
    .from("employer_roster_members")
    .select("id, status, claimed_profile_id, eligible_from, eligible_until")
    .eq("organisation_id", organisationId)
    .neq("status", "removed");
  if (!roster || roster.length === 0) return null;

  const eligibleRows = roster.filter(
    (r) => (r.eligible_from === null || r.eligible_from <= today) && (r.eligible_until === null || r.eligible_until >= today)
  );
  if (isCohortSuppressed(eligibleRows.length, minCohortSize)) return null;

  const activatedIds = eligibleRows
    .filter((r) => r.status === "claimed" && r.claimed_profile_id)
    .map((r) => r.claimed_profile_id as string);

  if (activatedIds.length === 0) {
    return { eligible: eligibleRows.length, activated: 0, engaged: 0, healthAssessmentPct: null, preventiveCompletionPct: null };
  }

  const since = new Date(Date.now() - ENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: recentVitals }, { data: recentScreenings }, { data: riskScores }, { data: completions }] =
    await Promise.all([
      supabase.from("vitals_readings").select("patient_id").in("patient_id", activatedIds).gte("created_at", since),
      supabase
        .from("screening_results")
        .select("patient_id")
        .in("patient_id", activatedIds)
        .gte("created_at", since),
      supabase.from("prevention_risk_scores").select("profile_id").in("profile_id", activatedIds),
      supabase.from("screening_completions").select("patient_id").in("patient_id", activatedIds),
    ]);

  const engagedIds = new Set<string>();
  for (const row of recentVitals ?? []) engagedIds.add(row.patient_id);
  for (const row of recentScreenings ?? []) engagedIds.add(row.patient_id);

  const assessedIds = new Set((riskScores ?? []).map((r) => r.profile_id));
  const completedIds = new Set((completions ?? []).map((c) => c.patient_id));

  return {
    eligible: eligibleRows.length,
    activated: activatedIds.length,
    engaged: engagedIds.size,
    healthAssessmentPct: Math.round((assessedIds.size / activatedIds.length) * 100),
    preventiveCompletionPct: Math.round((completedIds.size / activatedIds.length) * 100),
  };
}

/**
 * §26.9's worked example: "if a department contains only three people, the
 * system should not display detailed health statistics that could identify
 * individuals." Applies the SAME suppression floor per department that the
 * org-wide funnel above applies once — a department below minCohortSize gets
 * a `suppressed: true` row with its counts zeroed, never omitted outright
 * (an omitted row would itself leak "this department is small").
 */
export async function loadDepartmentBreakdown(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  minCohortSize: number
): Promise<DepartmentBreakdownRow[]> {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: roster }, { data: departments }] = await Promise.all([
    supabase
      .from("employer_roster_members")
      .select("status, department_id, eligible_from, eligible_until")
      .eq("organisation_id", organisationId)
      .neq("status", "removed"),
    supabase.from("employer_departments").select("id, name").eq("organisation_id", organisationId).eq("is_active", true),
  ]);
  if (!roster) return [];

  const nameById = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const byDept = new Map<string | null, { eligible: number; activated: number }>();

  for (const row of roster) {
    const eligible =
      (row.eligible_from === null || row.eligible_from <= today) &&
      (row.eligible_until === null || row.eligible_until >= today);
    if (!eligible) continue;
    const key = row.department_id;
    const bucket = byDept.get(key) ?? { eligible: 0, activated: 0 };
    bucket.eligible += 1;
    if (row.status === "claimed") bucket.activated += 1;
    byDept.set(key, bucket);
  }

  return Array.from(byDept.entries()).map(([departmentId, counts]) => {
    const suppressed = isCohortSuppressed(counts.eligible, minCohortSize);
    return {
      departmentId,
      departmentName: departmentId ? nameById.get(departmentId) ?? "Unknown department" : "No department set",
      eligible: suppressed ? 0 : counts.eligible,
      activated: suppressed ? 0 : counts.activated,
      suppressed,
    };
  });
}
