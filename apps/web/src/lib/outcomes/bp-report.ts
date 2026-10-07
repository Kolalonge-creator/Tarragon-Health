import { z } from "zod";

/**
 * The 90-day BP control report as the database returns it (S38). Parsed, never trusted: a reply that does not match is shown as "the
 * report could not be read" instead of half-rendered numbers. A cohort is either withheld (a small number: nothing about it is shown)
 * or carries its counts and rates. Nothing here ever holds a person.
 */
const withheld = z.object({ suppressed: z.literal(true), reason: z.enum(["under_minimum", "small_cell"]), minimum: z.number().int(), n: z.number().int().optional() });
const shown = z.object({
  suppressed: z.literal(false),
  n: z.number().int(),
  controlled: z.number().int(),
  uncontrolled: z.number().int(),
  insufficient_data: z.number().int(),
  rate_strict_pct: z.number(),
  rate_among_measured_pct: z.number().nullable().optional(),
  missing_pct: z.number(),
});
export const cohortSchema = z.union([shown, withheld]);
export type Cohort = z.infer<typeof cohortSchema>;

const month = z.intersection(z.object({ enrolment_month: z.string() }), cohortSchema);

export const reportSchema = z.object({
  measure: z.literal("bp_control_90d"),
  config_version: z.number().int(),
  minimum_cell: z.number().int(),
  cohort_all_due: cohortSchema,
  cohort_baseline_uncontrolled: cohortSchema,
  change_among_measured: z.union([z.object({ n: z.number().int(), mean_systolic_change: z.number(), mean_diastolic_change: z.number() }), withheld]),
  adherence_separate: z.union([z.object({ n: z.number().int(), mean_pct: z.number() }), withheld]),
  by_enrolment_month: z.array(month),
  months_withheld: z.number().int(),
  data_quality: z.union([
    z.object({
      enrolled_total: z.number().int(), not_yet_due: z.number().int(), baseline_missing_pct: z.number(), day90_no_reading_pct: z.number(),
      default_target_used_pct: z.number(), readings_arriving_after_snapshot_pct: z.number(), adherence_unavailable_pct: z.number().optional(),
    }),
    withheld.extend({ enrolled_total: z.number().int().optional(), not_yet_due: z.number().int().optional() }),
  ]),
  definition: z.string(),
  limitations: z.string(),
  range: z.object({ from: z.string().nullable(), to: z.string().nullable() }).optional(),
  not_a_causal_claim: z.literal(true),
  generated_at: z.string(),
});
export type BpReport = z.infer<typeof reportSchema>;

export function parseReport(data: unknown): BpReport | null {
  const r = reportSchema.safeParse(data);
  return r.success ? r.data : null;
}

/** "31.6%" for a shown rate; null when there is nothing to show. */
export const pct = (n: number | null | undefined): string | null => (typeof n === "number" ? `${n.toFixed(1)}%` : null);

export const isShown = (c: Cohort): c is z.infer<typeof shown> => c.suppressed === false;

export function withheldText(c: z.infer<typeof withheld>): string {
  return c.reason === "under_minimum"
    ? `Fewer than ${c.minimum} people, so nothing is shown.`
    : `One group is smaller than ${c.minimum}, so the counts and rates are withheld.`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** An optional from or to date from the page's query string; anything that is not a plain date is ignored. */
export const dateParam = (v: string | string[] | undefined): string | null => {
  const x = Array.isArray(v) ? v[0] : v;
  return x && DATE.test(x) && !Number.isNaN(new Date(`${x}T00:00:00Z`).getTime()) ? x : null;
};
