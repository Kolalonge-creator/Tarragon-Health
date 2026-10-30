import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { lowCarbCheckins, parseLowCarbGate, type LowCarbCheckinLine, type LowCarbConfig } from "@tarragon/clinical/lowcarb-programme";
import { readPatientVitalsAudited } from "@/lib/clinical/vitals-audited";

/**
 * What the patient's low-carbohydrate screen reads (S50b). The database door `my_lowcarb_gate()` answers `ok` or `unavailable`, and `unavailable` is
 * ONE answer for "not offered", "not live yet" and "withheld", so this screen cannot tell the patient why. It never carries a reading or a reason a
 * programme was paused. Anything that cannot be read is unavailable, never a guess.
 */

const rule = z.object({ per_week: z.number(), max_gap_days: z.number() });
const okSchema = z.object({
  state: z.literal("ok"),
  enrolment_id: z.string(),
  status: z.enum(["offered", "active", "paused"]),
  // numbers that are missing or malformed degrade to 'no number / no lines'; only the id and status are essential (Stop must always be reachable)
  check_ins: z.object({ glucose: rule, ketones: rule, weight: rule }).nullable().catch(null),
  // null when no signed rules are live: someone already on the programme still gets the card and Stop, without the number
  low_glucose_below_mmol: z.number().nullable().catch(null),
});

export type PatientLowCarb =
  | { state: "unavailable" }
  | { state: "error" }
  | { state: "ok"; enrolmentId: string; status: "offered" | "active" | "paused"; lowLine: number | null; checkins: LowCarbCheckinLine[] | null };

const UNAVAILABLE: PatientLowCarb = { state: "unavailable" };

export async function loadPatientLowCarb(supabase: SupabaseClient<Database>, patientId: string, now: Date = new Date()): Promise<PatientLowCarb> {
  const { data, error } = await supabase.rpc("my_lowcarb_gate");
  if (error) return UNAVAILABLE;
  if (parseLowCarbGate(data).state !== "ok") return UNAVAILABLE;
  const parsed = okSchema.safeParse(data);
  // The database said ok but the answer cannot be read: that is an error to retry, never "nothing here" (which would hide Stop and the low-sugar card).
  if (!parsed.success) return { state: "error" };
  const g = parsed.data;
  let checkins: LowCarbCheckinLine[] | null = null;
  if (g.status === "active" && g.check_ins) {
    const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    const [glucose, ketones, weight] = await Promise.all([
      readPatientVitalsAudited(supabase, patientId, { vitalType: "glucose", since, limit: 500 }),
      readPatientVitalsAudited(supabase, patientId, { vitalType: "ketones", since, limit: 500 }),
      readPatientVitalsAudited(supabase, patientId, { vitalType: "weight", since, limit: 100 }),
    ]);
    // An unreadable list is not "no check-ins": show no lines rather than a wall of "overdue".
    if (glucose.status === "ok" && ketones.status === "ok" && weight.status === "ok") {
      const cfg = { check_ins: g.check_ins } as unknown as LowCarbConfig;
      checkins = lowCarbCheckins(
        {
          now: now.toISOString(),
          readings: [
            ...glucose.rows.map((r) => ({ metric: "glucose" as const, at: r.taken_at })),
            ...ketones.rows.map((r) => ({ metric: "ketones" as const, at: r.taken_at })),
            ...weight.rows.map((r) => ({ metric: "weight" as const, at: r.taken_at })),
          ],
        },
        cfg,
      );
    }
  }
  return { state: "ok", enrolmentId: g.enrolment_id, status: g.status, lowLine: g.low_glucose_below_mmol, checkins };
}
