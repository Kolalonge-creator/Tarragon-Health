import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LeadershipFigure, PeriodBounds } from "@tarragon/shared";
import { excludeTestPatients } from "@/lib/queries/real-patients";

/**
 * Appointment figures for the selected period (CMO Clinical Operations, 2026-11-07), read from `appointments` under the caller's RLS
 * (org staff read every appointment in their organisation, so these counts are complete). Head counts only; test patients excluded.
 *
 * Definitions, by scheduled time inside the period:
 *  - completed: status completed.
 *  - no-show: status no_show.
 *  - cancelled: status cancelled, patient_cancelled or provider_cancelled.
 *  - attendance: completed / (completed + no-show). Cancellations are not attendance outcomes and stay out of the denominator.
 */
export type AppointmentFigures = {
  completed: LeadershipFigure;
  noShow: LeadershipFigure;
  cancelled: LeadershipFigure;
  scheduledInPeriod: LeadershipFigure;
};

const CANCELLED = ["cancelled", "patient_cancelled", "provider_cancelled"] as const;

export async function loadAppointmentFigures(
  supabase: SupabaseClient<Database>,
  bounds: PeriodBounds,
  testPatientIds: readonly string[]
): Promise<AppointmentFigures> {
  const base = () =>
    excludeTestPatients(
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .gte("scheduled_for", bounds.start.toISOString())
        .lt("scheduled_for", bounds.end.toISOString()),
      testPatientIds
    );
  const [all, completed, noShow, cancelled] = await Promise.all([
    base(),
    base().eq("status", "completed"),
    base().eq("status", "no_show"),
    base().in("status", [...CANCELLED]),
  ]);
  const n = (r: { count: number | null; error: unknown }): LeadershipFigure => (r.error ? null : (r.count ?? 0));
  return { scheduledInPeriod: n(all), completed: n(completed), noShow: n(noShow), cancelled: n(cancelled) };
}
