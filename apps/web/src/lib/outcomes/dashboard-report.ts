import { z } from "zod";

/**
 * The honest outcomes dashboard: what the database returns from `read_outcomes_dashboard`, checked once at the edge so the page and the
 * CSV only ever handle a known shape. Every figure is an aggregate; a held-back cell has `suppressed: true` and no number, and the types
 * make that impossible to forget (a shown cell has its numbers, a held-back one cannot be read as a zero).
 */

const withheld = z.object({ suppressed: z.literal(true), reason: z.string().optional(), minimum: z.number().optional(), n: z.number().optional() });
const interval = z.object({ low: z.number().nullable(), high: z.number().nullable() });
const meanCi = z.object({ n: z.number(), mean: z.number().optional(), sd: z.number().optional(), low: z.number().optional(), high: z.number().optional() });
const meanCiOrWithheld = z.union([withheld, meanCi.extend({ suppressed: z.undefined().optional() })]);

const countCell = z.union([withheld, z.object({ suppressed: z.literal(false), count: z.number(), people: z.number() })]);

const cohortCell = z.union([
  withheld,
  z.object({
    suppressed: z.literal(false),
    n: z.number(),
    controlled: z.number(),
    uncontrolled: z.number(),
    insufficient_data: z.number(),
    rate_strict_pct: z.number(),
    rate_among_measured_pct: z.number().nullable().optional(),
    missing_pct: z.number(),
  }),
]);

const engagement = z.object({
  month: z.string(),
  minimum_cell: z.number(),
  minimum_cell_by_cohort: z.number(),
  active_people: countCell,
  active_logging_days: z.union([withheld, z.object({ suppressed: z.literal(false), person_days: z.number(), people: z.number(), mean_per_active_person: z.number() })]),
  lessons_completed: countCell,
  medicine_checkins_answered: countCell,
  screenings_done: countCell,
  milestones: countCell,
  points_issued: z.union([withheld, z.object({ suppressed: z.literal(false), points: z.number(), earners: z.number() })]),
  by_cohort: z.array(
    z.union([
      withheld.extend({ cohort: z.string() }),
      z.object({ cohort: z.string(), suppressed: z.literal(false), active_people: z.number(), active_days: z.number(), mean_active_days: z.number(), points_issued: z.number() }),
    ]),
  ),
});

const htnBlock = z.object({
  day: z.number(),
  cohort: z.literal("hypertension"),
  due: cohortCell,
  before: cohortCell.optional(),
  strict_rate_interval: interval.optional(),
  measured_rate_interval: interval.nullable().optional(),
  systolic_change: meanCiOrWithheld.optional(),
  adherence: z.union([withheld, z.object({ suppressed: z.literal(false), people: z.number(), mean_pct: z.number() })]).optional(),
});
const dmBlock = z.object({
  day: z.number(),
  cohort: z.literal("diabetes"),
  hba1c_change: meanCiOrWithheld,
  not_measured_pct: z.number().nullable().optional(),
  hba1c_goal: z.union([withheld, z.object({ suppressed: z.literal(false), people: z.number(), reached: z.number(), reached_pct: z.number(), interval: interval })]),
});
const outcomes = z.object({
  data_cutoff: z.string(),
  minimum_cell: z.number(),
  hypertension: z.array(htnBlock),
  diabetes: z.array(dmBlock),
  time_to_first_review: z.union([
    withheld,
    z.object({ suppressed: z.literal(false), people: z.number(), results: z.number(), reviewed: z.number(), waiting_for_first_review: z.number(), median_hours: z.number().nullable().optional(), p90_hours: z.number().nullable().optional() }),
  ]),
  escalations: z.array(z.union([withheld.extend({ status: z.string() }), z.object({ status: z.string(), suppressed: z.literal(false), people: z.number() })])),
  not_measured: z.array(z.string()),
});

const did = z.union([
  z.object({ available: z.literal(false) }),
  z.object({ available: z.literal(true), difference: z.number(), low: z.number(), high: z.number(), interval_includes_zero: z.boolean() }),
]);
const htnGroup = z.union([
  withheld.extend({ group: z.string() }),
  z.object({
    group: z.string(),
    suppressed: z.literal(false),
    people_measured_at_both_ends: z.number(),
    not_measured_at_both_ends_pct: z.number().nullable().optional(),
    controlled_before_pct: z.number(),
    controlled_after_pct: z.number(),
    controlled_before_interval: interval,
    controlled_after_interval: interval,
    change_in_controlled_share: meanCi,
    systolic_change: meanCi,
  }),
]);
const dmGroup = z.union([
  withheld.extend({ group: z.string() }),
  z.object({ group: z.string(), suppressed: z.literal(false), people_with_hba1c_change: z.number(), not_measured_pct: z.number().nullable().optional(), hba1c_change: meanCi }),
]);
const split = <G extends z.ZodTypeAny, D extends z.ZodTypeAny>(g: G, d: D) =>
  z.object({ groups: z.array(g), high_group: z.string(), low_group: z.string(), difference_in_differences: d });
const comparison = z.object({
  day: z.number(),
  minimum_per_group: z.number(),
  confidence_level: z.number(),
  pre_period: z.string(),
  engagement_excludes_blood_pressure_readings: z.boolean(),
  cohorts: z.object({
    hypertension: z.object({ engagement: split(htnGroup, z.object({ control: did, systolic: did, control_strict: did })), points: split(htnGroup, z.object({ control: did, systolic: did, control_strict: did })) }),
    diabetes: z.object({ engagement: split(dmGroup, z.object({ hba1c: did })), points: split(dmGroup, z.object({ hba1c: did })) }),
  }),
  association_not_proof: z.literal(true),
  not_a_causal_claim: z.literal(true),
});

export const dashboardRowSchema = z.object({
  id: z.string(),
  period_start: z.string(),
  data_cutoff: z.string(),
  held_back: z.boolean(),
  config_version: z.number(),
  is_baseline: z.boolean(),
  publishable: z.literal(false),
  generated_at: z.string(),
  report: z.object({
    schema: z.number(),
    month: z.string(),
    panels: z.object({ engagement, outcomes, comparison }),
    held_back: z.boolean(),
    not_a_causal_claim: z.literal(true),
    internal_only: z.literal(true),
  }),
});

export type DashboardRow = z.infer<typeof dashboardRowSchema>;
export type Engagement = z.infer<typeof engagement>;
export type Outcomes = z.infer<typeof outcomes>;
export type Comparison = z.infer<typeof comparison>;
export type CohortCell = z.infer<typeof cohortCell>;
export type CountCell = z.infer<typeof countCell>;
export type HtnGroup = z.infer<typeof htnGroup>;
export type DmGroup = z.infer<typeof dmGroup>;
export type MeanCell = z.infer<typeof meanCiOrWithheld>;
export type Did = z.infer<typeof did>;

/** The rows from the database, newest first, or null when anything is not the shape promised (the page then says so and shows nothing). */
export function parseDashboard(data: unknown): DashboardRow[] | null {
  const parsed = z.array(dashboardRowSchema).safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function isShown<T extends { suppressed?: boolean }>(c: T): c is Exclude<T, { suppressed: true }> {
  return c.suppressed !== true;
}

/** A percentage with one decimal, or a dash for no number. A held-back figure is never passed here. */
export function pct(x: number | null | undefined): string {
  return x == null ? "-" : `${x.toFixed(1)}%`;
}
/** A proportion (0 to 1) as a percentage, for the Wilson interval ends. */
export function pctOfShare(x: number | null | undefined): string {
  return x == null ? "-" : `${(x * 100).toFixed(1)}%`;
}
/** A signed number: a fall is a minus sign, a rise a plus sign. */
export function signed(x: number | null | undefined, digits = 1): string {
  if (x == null) return "-";
  const s = x.toFixed(digits);
  return x > 0 ? `+${s}` : s;
}
/** A change in a share (-1 to 1) as percentage points. */
export function points(x: number | null | undefined): string {
  return x == null ? "-" : signed(x * 100, 1);
}

/** The plain-English reason a figure is held back, as a catalogue key. */
export function withheldKey(c: { reason?: string }): "outcomes.dash.withheld" | "outcomes.dash.withheld_neighbour" | "outcomes.dash.withheld_small_cell" {
  if (c.reason === "complementary") return "outcomes.dash.withheld_neighbour";
  if (c.reason === "small_cell") return "outcomes.dash.withheld_small_cell";
  return "outcomes.dash.withheld";
}

/** The month series for the engagement chart: only months whose cell is shown, oldest first. A held-back month is a gap, never a zero. */
export function engagementSeries(rows: DashboardRow[]): { month: string; people: number | null; points: number | null }[] {
  return [...rows]
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
    .map((r) => {
      const e = r.report.panels.engagement;
      return {
        month: r.period_start.slice(0, 7),
        people: e.active_people.suppressed ? null : e.active_people.people,
        points: e.points_issued.suppressed ? null : e.points_issued.points,
      };
    });
}

/** The mean of a mean-with-interval cell, or null when it is held back or has no mean. */
export function meanOf(x: MeanCell | undefined): number | null {
  if (!x || ("suppressed" in x && x.suppressed === true)) return null;
  return "mean" in x && typeof x.mean === "number" ? x.mean : null;
}

/** A mean with its interval, or null when the cell is held back or has too few values to give one. */
export function meanCiOf(x: MeanCell | undefined): { n: number; mean: number; low: number | null; high: number | null } | null {
  if (!x || ("suppressed" in x && x.suppressed === true)) return null;
  if (!("mean" in x) || typeof x.mean !== "number") return null;
  return { n: x.n, mean: x.mean, low: typeof x.low === "number" ? x.low : null, high: typeof x.high === "number" ? x.high : null };
}

/** The founder's unfrozen view: the outcome and comparison figures to today. It is never stored, so it has no id, month or record flags. */
const founderView = z.object({
  founder_view: z.literal(true),
  stored: z.literal(false),
  as_of: z.string(),
  outcomes,
  comparison,
  not_a_causal_claim: z.literal(true),
  internal_only: z.literal(true),
});
export type FounderView = z.infer<typeof founderView>;
export function parseFounderView(data: unknown): FounderView | null {
  const parsed = founderView.safeParse(data);
  return parsed.success ? parsed.data : null;
}
