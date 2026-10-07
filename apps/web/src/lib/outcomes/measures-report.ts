import { z } from "zod";

/**
 * The other outcome reports as the database returns them (S75b/S75c): HbA1c, weight, PHQ-9 and GAD-7; retention and engagement; response times;
 * data quality; the monthly fairness history. Parsed, never trusted. A figure is either withheld (nothing about it is shown) or carries its counts.
 */
const withheld = z.object({ suppressed: z.literal(true), reason: z.string().optional(), minimum: z.number().int().optional() });

const pairs = z.union([
  withheld,
  z.object({ suppressed: z.literal(false), n: z.number().int(), improved: z.number().int(), improved_pct: z.number(), mean_change: z.number().nullable(), at_goal_pct: z.number().nullable().optional() }),
]);
const band = z.union([
  z.object({ baseline_band: z.string(), suppressed: z.literal(true) }),
  z.object({ baseline_band: z.string(), suppressed: z.literal(false), n: z.number().int(), responded_pct: z.number(), in_remission_pct: z.number(), mean_change: z.number().nullable() }),
]);
const dayCohort = z.object({
  due_day: z.number().int(),
  pairs,
  coverage: z.union([withheld, z.object({ suppressed: z.literal(false), due: z.number().int(), with_usable_pair: z.number().int(), with_usable_pair_pct: z.number().nullable(), no_reading_pct: z.number().nullable() })]),
  excluded: z.union([withheld, z.object({ suppressed: z.literal(false), n: z.number().int() })]),
  by_baseline_band: z.array(band).nullable(),
});

export const MEASURES = ["hba1c", "weight", "phq9", "gad7"] as const;
export type Measure = (typeof MEASURES)[number];

const measureReply = z.union([
  z.object({ measure: z.string(), withheld: z.literal(true), reason: z.string(), has_data: z.boolean() }),
  z.object({ measure: z.string(), withheld: z.literal(false), has_data: z.literal(false) }),
  z.object({
    measure: z.string(), withheld: z.literal(false), has_data: z.literal(true), minimum_cell: z.number().int(), by_day: z.record(z.string(), dayCohort),
    definition: z.string(), limitations: z.string(), caveat: z.string().nullable().optional(), config_version: z.number().int(),
  }),
]);
export type MeasureReport = z.infer<typeof measureReply>;
export type DayCohort = z.infer<typeof dayCohort>;
export function parseMeasureReport(data: unknown): MeasureReport | null {
  const r = measureReply.safeParse(data);
  return r.success ? r.data : null;
}
export const isPairsShown = (p: DayCohort["pairs"]): p is Extract<DayCohort["pairs"], { suppressed: false }> => p.suppressed === false;

const retentionDay = z.union([
  z.object({ day: z.number().int() }).and(withheld),
  z.object({ day: z.number().int(), suppressed: z.literal(false), due: z.number().int(), retained: z.number().int(), retained_pct: z.number(), engaged_pct: z.number().nullable() }),
]);
export const retentionSchema = z.object({
  by_day: z.array(retentionDay),
  programme_completion: z.union([withheld, z.object({ suppressed: z.literal(false), ended_entitlements: z.number().int(), fully_used: z.number().int(), fully_used_pct: z.number(), label: z.string() })]),
  definition: z.string(), limitations: z.string(), minimum_cell: z.number().int(),
});
export type RetentionReport = z.infer<typeof retentionSchema>;
export const parseRetention = (d: unknown): RetentionReport | null => { const r = retentionSchema.safeParse(d); return r.success ? r.data : null; };

const band2 = z.union([
  z.object({ priority_band: z.string(), suppressed: z.literal(true) }),
  z.object({ priority_band: z.string(), suppressed: z.literal(false), tasks: z.number().int(), completed_pct: z.number(), completed_on_time_pct: z.number(), escalation_rate_pct: z.number(), handed_back_pct: z.number(),
    median_minutes_to_first_claim: z.number().nullable(), p90_minutes_to_first_claim: z.number().nullable(), median_minutes_to_completion: z.number().nullable() }),
]);
const tier = z.union([
  z.object({ doctor_tier: z.string(), suppressed: z.literal(true), reason: z.string().optional() }),
  z.object({ doctor_tier: z.string(), suppressed: z.literal(false), tasks_finished: z.number().int(), median_minutes_to_completion: z.number().nullable() }),
]);
export const responseSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }), minimum_cell: z.number().int(), minimum_clinicians_per_tier: z.number().int(),
  by_priority_band: z.array(band2), by_finisher_tier: z.array(tier),
  follow_up: z.union([z.object({ type: z.string(), suppressed: z.literal(true), minimum: z.number().int() }), z.object({ type: z.string(), suppressed: z.literal(false), tasks: z.number().int(), completed_pct: z.number(), completed_on_time_pct: z.number() })]),
  what_this_is: z.string(), limitations: z.string(),
});
export type ResponseReport = z.infer<typeof responseSchema>;
export const parseResponse = (d: unknown): ResponseReport | null => { const r = responseSchema.safeParse(d); return r.success ? r.data : null; };

export const qualitySchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }), minimum_cell: z.number().int(),
  snapshot_completeness: z.array(z.union([
    z.object({ family: z.string(), day: z.number().int() }).and(withheld),
    z.object({ family: z.string(), day: z.number().int(), suppressed: z.literal(false), due: z.number().int(), measured_pct: z.number(), nothing_recorded_pct: z.number(), excluded_pct: z.number() }),
  ])),
  reading_sources: z.array(z.union([
    z.object({ source: z.string() }).and(withheld),
    z.object({ source: z.string(), suppressed: z.literal(false), people: z.number().int(), readings: z.number().int(), flagged_for_review_pct: z.number() }),
  ])),
  sync_lag: z.union([withheld, z.object({ suppressed: z.literal(false), readings: z.number().int(), median_hours_to_arrive: z.number().nullable(), arrived_after_grace_pct: z.number(), grace_days: z.number().int() })]),
  what_this_is: z.string(), limitations: z.string(),
});
export type QualityReport = z.infer<typeof qualitySchema>;
export const parseQuality = (d: unknown): QualityReport | null => { const r = qualitySchema.safeParse(d); return r.success ? r.data : null; };

export const fairnessHistorySchema = z.array(z.object({
  month: z.string(), generated_at: z.string(), reviewed: z.boolean(), reviewed_at: z.string().nullable(), review_note: z.string().nullable(), reviewed_by_name: z.string().nullable(),
  payload: z.object({ total_scored: z.number().int().nullable(), minimum_cell: z.number().int(), by: z.object({ sex: z.array(z.record(z.string(), z.unknown())), age_band: z.array(z.record(z.string(), z.unknown())), region: z.array(z.record(z.string(), z.unknown())) }) }),
}));
export type FairnessHistory = z.infer<typeof fairnessHistorySchema>;
export const parseFairnessHistory = (d: unknown): FairnessHistory | null => { const r = fairnessHistorySchema.safeParse(d); return r.success ? r.data : null; };

const WITHHELD_WORDS: Record<string, string> = {
  under_minimum: "Fewer than the minimum number of people, so nothing is shown.",
  small_cell: "One group inside it is smaller than the minimum, so the counts and rates are withheld.",
  complementary: "Withheld so that a smaller group beside it cannot be worked out by subtraction.",
  few_clinicians: "Too few different clinicians behind this row, so nothing is shown.",
  awaiting_cmo_signature: "Awaiting the Chief Medical Officer's signature on the definitions. No figure is shown until then.",
};
export const withheldWords = (reason: string | undefined): string => WITHHELD_WORDS[reason ?? ""] ?? "Withheld.";

/** Minutes as a short phrase: "45 min", "3 h 10 min". */
export function minutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return "not enough data";
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}
