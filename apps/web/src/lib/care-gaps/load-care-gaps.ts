import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { isCohortSuppressed } from "@/lib/institutions/suppression";

export type CareGapType = "overdue_screening" | "stale_monitoring" | "unactioned_abnormal";

/**
 * Counts only. There is deliberately no per-member row type here.
 *
 * Until 2026-07-29 this returned a `rows: CareGapRow[]` carrying each member's
 * patient number, gap type and condition, which the employer/HMO dashboard
 * rendered as an expandable list — so an employer could read "PT-000123 ·
 * Unactioned abnormal result — diabetes". I9 forbids an institution reaching
 * an individual, and the row type is removed rather than merely unrendered so
 * the drill-down cannot be reinstated by uncommenting a component.
 */
export type CareGapSummary = {
  totalOpen: number;
  byType: Record<CareGapType, number>;
  closedLast90Days: number;
  /** Denominator for the suppression decision, never the members themselves. */
  cohortSize: number;
};

const LOOKBACK_DAYS = 90;

/**
 * Queries the security_invoker patient_care_gaps view, scoped by
 * organisation_id — RLS on the underlying tables (screening_schedules,
 * care_plans, screening_results, patient_risk_scores) does the actual
 * access control, this is just a convenience org filter on top.
 *
 * "Closed in last 90 days" isn't tracked as history (gaps are derived, not
 * stored) — it's approximated here as: gaps whose underlying event
 * (opened_at) falls in the lookback window AND are no longer open today.
 * Since the view only ever returns *currently open* gaps, we can't diff
 * against a past snapshot without one; this uses screening_schedules rows
 * that were overdue-shaped in the window but are now completed/booked, and
 * screening_results/care_plans that were unactioned/stale in the window but
 * now have a qualifying care_plan — i.e. a second, narrower query for the
 * "was open, now isn't" case, scoped to the same org.
 */
export async function loadCareGaps(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  minCohortSize: number
): Promise<CareGapSummary | null> {
  const { data: patients } = await supabase
    .from("profiles")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("role", "patient");
  if (!patients || patients.length === 0) return null;
  // I9 small-cell suppression — a gap count over a handful of people names
  // them by implication. Same gate as loadCohortAnalytics.
  if (isCohortSuppressed(patients.length, minCohortSize)) return null;

  const patientIds = patients.map((p) => p.id);

  const { data: openGaps, error } = await supabase
    .from("patient_care_gaps")
    .select("gap_type, patient_id, opened_at")
    .in("patient_id", patientIds);
  if (error) throw error;

  const byType: Record<CareGapType, number> = {
    overdue_screening: 0,
    stale_monitoring: 0,
    unactioned_abnormal: 0,
  };
  let totalOpen = 0;
  for (const row of openGaps ?? []) {
    if (!row.gap_type || !row.patient_id || !row.opened_at) continue;
    const gapType = row.gap_type as CareGapType;
    if (!(gapType in byType)) continue;
    byType[gapType] += 1;
    totalOpen += 1;
  }

  const closedLast90Days = await countClosedInWindow(supabase, patientIds);

  return { totalOpen, byType, closedLast90Days, cohortSize: patients.length };
}

async function countClosedInWindow(
  supabase: SupabaseClient<Database>,
  patientIds: string[]
): Promise<number> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - LOOKBACK_DAYS);
  const windowStartIso = windowStart.toISOString().slice(0, 10);

  // Screenings that were due inside the window and are now completed —
  // these were an overdue_screening gap at some point and are now closed.
  const { count: completedScreenings } = await supabase
    .from("screening_schedules")
    .select("id", { count: "exact", head: true })
    .in("patient_id", patientIds)
    .eq("status", "completed")
    .gte("due_date", windowStartIso)
    .lt("due_date", new Date().toISOString().slice(0, 10));

  // Abnormal results from inside the window that now have a qualifying
  // active care_plan opened after them — these were unactioned_abnormal and
  // are now actioned.
  const { data: abnormalInWindow } = await supabase
    .from("screening_results")
    .select("patient_id, created_at")
    .in("patient_id", patientIds)
    .in("result_status", ["abnormal", "critical"])
    .gte("created_at", windowStart.toISOString());

  let actionedAbnormal = 0;
  if (abnormalInWindow && abnormalInWindow.length > 0) {
    const { data: activeCarePlans } = await supabase
      .from("care_plans")
      .select("patient_id, created_at")
      .in(
        "patient_id",
        abnormalInWindow.map((r) => r.patient_id)
      )
      .eq("status", "active");
    for (const result of abnormalInWindow) {
      const hasFollowUp = (activeCarePlans ?? []).some(
        (cp) => cp.patient_id === result.patient_id && cp.created_at >= result.created_at
      );
      if (hasFollowUp) actionedAbnormal += 1;
    }
  }

  return (completedScreenings ?? 0) + actionedAbnormal;
}
