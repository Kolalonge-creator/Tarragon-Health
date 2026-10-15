import { z } from "zod";

/**
 * The HbA1c and weight outcome report, and the day-180 BP report, as the database returns them (S75, CMO decision S-5). Parsed, never
 * trusted: a reply that does not match is shown as "not available" instead of half-rendered numbers. This file knows nothing about
 * mental health outcomes on purpose: they are never part of an admin or sponsor screen, only the patient and a treating clinician see
 * them (S-3), so no schema, label or loader for them lives here.
 */
const withheld = z.object({ suppressed: z.literal(true), reason: z.enum(["under_minimum", "small_cell"]), minimum: z.number().int(), n: z.number().int().optional() });
const shown = z.object({
  suppressed: z.literal(false),
  n: z.number().int(),
  reached: z.number().int(),
  not_reached: z.number().int(),
  insufficient_data: z.number().int(),
  rate_strict_pct: z.number(),
  rate_among_measured_pct: z.number().nullable().optional(),
  missing_pct: z.number(),
});
export const measureCohortSchema = z.union([shown, withheld]);
export type MeasureCohort = z.infer<typeof measureCohortSchema>;

const change = z.union([
  z.object({ suppressed: z.literal(false), n: z.number().int(), mean_change_percentage_points: z.number().optional(), mean_change_percent: z.number().optional(), mean_change_kg: z.number().optional() }),
  withheld,
]);

export const measureReportSchema = z.object({
  measure: z.enum(["hba1c", "weight"]),
  day: z.number().int(),
  config_version: z.number().int(),
  minimum_cell: z.number().int(),
  goal: z.string(),
  cohort_all_due: measureCohortSchema,
  change_among_measured: change,
  data_quality: z.union([z.object({ baseline_missing_pct: z.number(), care_plan_target_used_pct: z.number().nullable().optional() }), withheld]),
  definition: z.string(),
  limitations: z.string(),
  comparison_group: z.literal("none"),
  not_a_causal_claim: z.literal(true),
  generated_at: z.string(),
});
export type MeasureReport = z.infer<typeof measureReportSchema>;

export function parseMeasureReport(data: unknown): MeasureReport | null {
  const r = measureReportSchema.safeParse(data);
  return r.success ? r.data : null;
}

export const isMeasureShown = (c: MeasureCohort): c is z.infer<typeof shown> => c.suppressed === false;

export function measureWithheldText(c: z.infer<typeof withheld>): string {
  return c.reason === "under_minimum"
    ? `Fewer than ${c.minimum} people, so nothing is shown.`
    : `One group is smaller than ${c.minimum}, so the counts and rates are withheld.`;
}

/** The measures and days the admin screen asks for. A day the live config does not list is refused by the database and shown as not switched on. */
export const MEASURE_REQUESTS = [
  { measure: "hba1c", day: 90, title: "HbA1c at day 90", noun: "reached the HbA1c goal" },
  { measure: "hba1c", day: 180, title: "HbA1c at day 180", noun: "reached the HbA1c goal" },
  { measure: "weight", day: 90, title: "Weight at day 90", noun: "lost 5% or more of their starting weight" },
  { measure: "weight", day: 180, title: "Weight at day 180", noun: "lost 5% or more of their starting weight" },
] as const;

/** The day-180 BP report has the same shape as the day-90 one, with a different measure code and no adherence block. */
const bpCohortShown = z.object({
  suppressed: z.literal(false), n: z.number().int(), controlled: z.number().int(), uncontrolled: z.number().int(), insufficient_data: z.number().int(),
  rate_strict_pct: z.number(), rate_among_measured_pct: z.number().nullable().optional(), missing_pct: z.number(),
});
const bpCohort = z.union([bpCohortShown, withheld]);
export const bp180Schema = z.object({
  measure: z.literal("bp_control_180d"),
  day: z.literal(180),
  config_version: z.number().int(),
  minimum_cell: z.number().int(),
  cohort_all_due: bpCohort,
  cohort_baseline_uncontrolled: bpCohort,
  change_among_measured: z.union([z.object({ n: z.number().int(), mean_systolic_change: z.number(), mean_diastolic_change: z.number() }), withheld]),
  definition: z.string(),
  limitations: z.string(),
  comparison_group: z.literal("none"),
  not_a_causal_claim: z.literal(true),
});
export type Bp180Report = z.infer<typeof bp180Schema>;
export function parseBp180(data: unknown): Bp180Report | null {
  const r = bp180Schema.safeParse(data);
  return r.success ? r.data : null;
}
export const isBpShown = (c: z.infer<typeof bpCohort>): c is z.infer<typeof bpCohortShown> => c.suppressed === false;
