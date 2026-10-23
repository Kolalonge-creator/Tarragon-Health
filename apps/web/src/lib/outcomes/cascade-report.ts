import { z } from "zod";

/**
 * The cascade-of-care report and the selection-bias panel as the database returns them (WP3). Parsed, never trusted: a reply that does not match
 * is shown as "not available" instead of half-rendered numbers. A figure that is withheld has no number in the reply, so none can be drawn here;
 * control that cannot be read is "unknown" and stays in the figure. Nothing here names or ranks a clinician.
 */
/** Nothing is shown: either the CMO has not signed the definitions, or the nightly snapshot has not run yet under them. No number is in the reply. */
const awaiting = z.object({ withheld: z.literal(true), reason: z.enum(["awaiting_cmo_signature", "snapshot_pending"]), condition: z.string().optional() });

const stageShown = z.object({
  code: z.string(), label: z.string(), definition: z.string(), suppressed: z.literal(false),
  n: z.number().int(), pct_of_enrolled: z.number().nullable(), step_of: z.string().nullable(), pct_of_step: z.number().nullable(),
});
const stageWithheld = z.object({ code: z.string(), label: z.string(), definition: z.string(), suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() });
const stage = z.union([stageShown, stageWithheld]);

const controlShown = z.object({ key: z.string(), suppressed: z.literal(false), n: z.number().int(), pct_of_treated: z.number().nullable() });
const controlWithheld = z.object({ key: z.string(), suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() });

const cascadeBlock = z.union([
  z.object({ suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() }),
  z.object({ suppressed: z.literal(false), stages: z.array(stage), control_among_treated: z.array(z.union([controlShown, controlWithheld])) }),
]);

const monthRow = z.union([
  z.object({ month: z.string(), suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() }),
  z.object({ month: z.string(), cascade: cascadeBlock }),
]);

export const cascadeReportSchema = z.union([
  awaiting,
  z.object({
    condition: z.enum(["hypertension", "diabetes"]),
    config_version: z.number().int(),
    minimum_cell: z.number().int(),
    /** The day of the nightly snapshot these figures are from (Lagos date). */
    as_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    total: cascadeBlock,
    by_month_of_joining: z.array(monthRow),
    not_available: z.array(z.object({ item: z.string(), reason: z.string() })),
    note: z.string(),
    difference_from_bp_outcome_reports: z.string(),
    comparison_group: z.literal("none"),
    not_a_causal_claim: z.literal(true),
  }),
]);
export type CascadeReport = z.infer<typeof cascadeReportSchema>;
export type CascadeBlock = z.infer<typeof cascadeBlock>;
export type CascadeStage = z.infer<typeof stage>;

export function parseCascadeReport(data: unknown): CascadeReport | null {
  const r = cascadeReportSchema.safeParse(data);
  return r.success ? r.data : null;
}
export const isWithheldReport = (r: CascadeReport): r is z.infer<typeof awaiting> => "withheld" in r;
/** @deprecated kept for older imports: the same test as isWithheldReport. */
export const isAwaitingSignature = isWithheldReport;

/** Plain words for a report or panel that shows nothing. */
export function withheldReportText(reason: "awaiting_cmo_signature" | "snapshot_pending"): string {
  return reason === "snapshot_pending"
    ? "The first nightly snapshot has not run yet. Figures appear here once it has, and say which day they are as at."
    : "Awaiting the Chief Medical Officer's signature of the definitions. Nothing is counted until then.";
}
export const isStageShown = (s: CascadeStage): s is z.infer<typeof stageShown> => s.suppressed === false;

const KEY_LABELS: Record<string, string> = { controlled: "Controlled", uncontrolled: "Not controlled", unknown: "Control unknown (too few or no recent readings)" };
export const controlLabel = (key: string): string => KEY_LABELS[key] ?? key;

/** Plain-words reason a figure is not shown. Never hints at a number. */
export function stageWithheldText(reason: string, minimum: number): string {
  if (reason === "under_minimum") return `Fewer than ${minimum} people, so nothing is shown.`;
  if (reason === "small_difference") return `The gap to the step before is smaller than ${minimum} people, so this figure is withheld.`;
  if (reason === "parent_withheld") return "The step before it is withheld, so this one is too.";
  if (reason === "complementary") return "Withheld because a neighbouring figure is too small to show.";
  return `A group is smaller than ${minimum}, so this figure is withheld.`;
}

/* ---------------- the selection-bias panel ---------------- */
const catCell = z.union([
  z.object({ suppressed: z.literal(false), n: z.number().int(), pct: z.number() }),
  z.object({ suppressed: z.literal(true), reason: z.string() }),
]);
const compareResult = z.union([
  z.object({ suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() }),
  z.object({
    suppressed: z.literal(false), group_a_total: z.number().int(), group_b_total: z.number().int(),
    attributes: z.array(z.object({ attribute: z.string(), categories: z.array(z.object({ category: z.string(), group_a: catCell, group_b: catCell })) })),
  }),
]);
const comparison = z.union([
  z.object({ withheld: z.literal(true), reason: z.string() }),
  z.object({ group_a_is: z.string(), group_b_is: z.string(), result: compareResult, audience: z.string().optional() }),
]);
const ittShown = z.object({
  suppressed: z.literal(false), n: z.number().int(), controlled: z.number().int(), uncontrolled: z.number().int(), insufficient_data: z.number().int(),
  rate_strict_pct: z.number(), rate_among_measured_pct: z.number().nullable().optional(), missing_pct: z.number(),
});
const ittDay = z.union([
  z.object({ day: z.number().int(), suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() }),
  z.object({
    day: z.number().int(), suppressed: z.literal(false),
    everyone_who_joined: z.object({ suppressed: z.boolean(), n: z.number().int().optional() }),
    day_not_due_yet: z.object({ suppressed: z.boolean(), n: z.number().int().optional() }),
    intent_to_treat: z.union([ittShown, z.object({ suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() }).passthrough()]),
    completers_only: z.object({ note: z.string(), rate_pct: z.number().nullable().optional() }),
    missing_split: z.array(z.object({ key: z.string(), suppressed: z.boolean(), n: z.number().int().optional() })),
  }),
]);

export const selectionPanelSchema = z.union([
  awaiting,
  z.object({
    config_version: z.number().int(), minimum_cell: z.number().int(), as_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), audience: z.enum(["internal", "sponsor"]),
    who_is_in_the_figures: z.union([z.object({ suppressed: z.literal(false), in_figures: z.number().int() }), z.object({ suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() })]),
    eligible_roster: z.object({ available: z.literal(false), reason: z.string() }),
    seats: z.union([
      z.object({ suppressed: z.literal(false), seats_offered: z.number().int(), members_joined: z.number().int(), take_up_pct_of_seats: z.number().nullable(), note: z.string() }),
      z.object({ suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() }),
    ]),
    comparisons: z.object({ in_figures_vs_other_members: comparison, in_figures_vs_joined_not_agreed: comparison }),
    intent_to_treat_and_completers: z.record(z.string(), ittDay),
    note: z.string(),
    comparison_group: z.literal("none"),
    not_a_causal_claim: z.literal(true),
  }),
]);
export type SelectionPanel = z.infer<typeof selectionPanelSchema>;
export type SelectionComparison = z.infer<typeof comparison>;
export type IttDay = z.infer<typeof ittDay>;

export function parseSelectionPanel(data: unknown): SelectionPanel | null {
  const r = selectionPanelSchema.safeParse(data);
  return r.success ? r.data : null;
}
export const panelWithheld = (p: SelectionPanel): p is z.infer<typeof awaiting> => "withheld" in p;
export const isIttShown = (c: z.infer<typeof ittShown> | { suppressed: true }): c is z.infer<typeof ittShown> => c.suppressed === false;

const ATTRIBUTE_LABELS: Record<string, string> = { age_band: "Age when they joined", sex: "Sex", baseline_bp: "Blood pressure in the first week", channel: "How they joined" };
export const attributeLabel = (a: string): string => ATTRIBUTE_LABELS[a] ?? a;
export const MISSING_LABELS: Record<string, string> = { membership_ended: "Membership ended", still_a_member_no_reading: "Still a Member, no usable reading" };
