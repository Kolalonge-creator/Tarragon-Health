import type { SupabaseClient } from "@supabase/supabase-js";
import { CLOSED_ESCALATION_STATUSES, type Database, type LeadershipFigure, type PeriodBounds } from "@tarragon/shared";
import { excludeTestPatients } from "@/lib/queries/real-patients";

/**
 * Reporting-period figures for the CMO's overview (CMO command centre, 2026-11-07). Every figure is a head count on the
 * authoritative table under the caller's RLS; nothing is copied or cached into a dashboard table. A failed read is `null`
 * ("could not be loaded"), never 0. Test accounts are excluded (INV-13).
 *
 * Definitions (shown on the page next to each figure):
 *  - New registrations: patient accounts created in the period (profiles.role = patient, not a test account).
 *  - Consultations completed: video consultations with status completed whose end time falls in the period.
 *  - Escalations resolved: of the escalations raised in the period, how many are now resolved or referred.
 *  - Active care plans: patients with at least one care plan in status active, out of all patients (live, not period).
 */
export type PeriodPair = { current: LeadershipFigure; previous: LeadershipFigure };

export type LeadershipKpis = {
  /** Earliest real patient account, used to decide whether the previous period is comparable. */
  dataSince: string | null;
  registrations: PeriodPair;
  consultationsCompleted: PeriodPair;
  escalationsRaised: LeadershipFigure;
  escalationsResolved: LeadershipFigure;
  patientsTotal: LeadershipFigure;
  patientsWithActivePlan: LeadershipFigure;
};

const count = (res: { count: number | null; error: unknown }): LeadershipFigure => (res.error ? null : (res.count ?? 0));

/** Distinct patients with an active plan is computed from patient ids; above this many rows the figure is withheld rather than undercounted. */
const CARE_PLAN_ROW_CAP = 20_000;

export async function loadLeadershipKpis(
  supabase: SupabaseClient<Database>,
  bounds: PeriodBounds,
  testPatientIds: readonly string[]
): Promise<LeadershipKpis> {
  const iso = (d: Date) => d.toISOString();
  const patients = () => supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "patient").eq("is_test", false);
  const consultations = (from: Date, to: Date) =>
    excludeTestPatients(
      supabase
        .from("video_consultations")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("ended_at", iso(from))
        .lt("ended_at", iso(to)),
      testPatientIds
    );
  const escalations = () =>
    excludeTestPatients(
      supabase.from("escalations").select("id", { count: "exact", head: true }).gte("created_at", iso(bounds.start)).lt("created_at", iso(bounds.end)),
      testPatientIds
    );

  const [sinceRes, regNow, regPrev, conNow, conPrev, escRaised, escResolved, total, plans] = await Promise.all([
    supabase.from("profiles").select("created_at").eq("role", "patient").eq("is_test", false).order("created_at", { ascending: true }).limit(1),
    patients().gte("created_at", iso(bounds.start)).lt("created_at", iso(bounds.end)),
    patients().gte("created_at", iso(bounds.previousStart)).lt("created_at", iso(bounds.previousEnd)),
    consultations(bounds.start, bounds.end),
    consultations(bounds.previousStart, bounds.previousEnd),
    escalations(),
    escalations().in("status", [...CLOSED_ESCALATION_STATUSES]),
    patients(),
    excludeTestPatients(supabase.from("care_plans").select("patient_id").eq("status", "active").limit(CARE_PLAN_ROW_CAP + 1), testPatientIds),
  ]);

  const planRows = plans.error ? null : (plans.data ?? []);
  return {
    dataSince: sinceRes.error ? null : (sinceRes.data?.[0]?.created_at ?? null),
    registrations: { current: count(regNow), previous: count(regPrev) },
    consultationsCompleted: { current: count(conNow), previous: count(conPrev) },
    escalationsRaised: count(escRaised),
    escalationsResolved: count(escResolved),
    patientsTotal: count(total),
    patientsWithActivePlan:
      planRows === null || planRows.length > CARE_PLAN_ROW_CAP ? null : new Set(planRows.map((r) => r.patient_id)).size,
  };
}
