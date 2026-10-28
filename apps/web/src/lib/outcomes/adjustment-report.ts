import { z } from "zod";

/**
 * The hypertension control by medicine adjustment report as the database returns it (D3). Parsed, never trusted: a reply that does not match is
 * shown as "not available" instead of half-rendered numbers. A group that is withheld has no number in the reply. No clinician appears anywhere.
 */
const awaiting = z.object({
  withheld: z.literal(true),
  reason: z.enum(["awaiting_cmo_signature", "cascade_not_signed", "snapshot_pending"]),
  condition: z.string().optional(),
});

const groupShown = z.object({
  code: z.string(), label: z.string(), suppressed: z.literal(false), n: z.number().int(),
  controlled: z.number().int().optional(), uncontrolled: z.number().int().optional(), control_unknown: z.number().int().optional(),
  rate_strict_pct: z.number().nullable().optional(), rate_among_known_pct: z.number().nullable().optional(), missing_pct: z.number().nullable().optional(),
});
const groupWithheld = z.object({ code: z.string(), label: z.string(), suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() });
const group = z.union([groupShown, groupWithheld]);

const count = z.union([
  z.object({ suppressed: z.literal(false), n: z.number().int() }),
  z.object({ suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() }),
]);

export const adjustmentReportSchema = z.union([
  awaiting,
  z.object({
    condition: z.literal("hypertension"),
    config_version: z.number().int(),
    cascade_config_version: z.number().int(),
    minimum_cell: z.number().int(),
    as_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    window_days: z.number().int(),
    adjusted: group,
    not_adjusted: group,
    on_recorded_medicine: count,
    not_on_recorded_medicine: count,
    limitations: z.string(),
    note: z.string(),
    comparison_group: z.literal("none"),
    not_a_causal_claim: z.literal(true),
  }),
]);
export type AdjustmentReport = z.infer<typeof adjustmentReportSchema>;
export type AdjustmentGroup = z.infer<typeof group>;

export function parseAdjustmentReport(data: unknown): AdjustmentReport | null {
  const r = adjustmentReportSchema.safeParse(data);
  return r.success ? r.data : null;
}
export const isAdjustmentWithheld = (r: AdjustmentReport): r is z.infer<typeof awaiting> => "withheld" in r;
export const isGroupShown = (g: AdjustmentGroup): g is z.infer<typeof groupShown> => g.suppressed === false;

export function adjustmentWithheldText(reason: "awaiting_cmo_signature" | "cascade_not_signed" | "snapshot_pending"): string {
  if (reason === "cascade_not_signed") return "The cascade of care definitions have not been signed yet, so there is nothing to split.";
  if (reason === "snapshot_pending") return "The first nightly snapshot has not run yet. Figures appear here once it has.";
  return "Awaiting the Chief Medical Officer's signature of what counts as an adjustment. Nothing is counted until then.";
}

/** Plain-words reason a figure is not shown. Never hints at a number. */
export function groupWithheldText(reason: string, minimum: number): string {
  if (reason === "under_minimum") return `Fewer than ${minimum} people, so nothing is shown.`;
  if (reason === "a_group_is_withheld") return "Withheld while one of the two groups is withheld, so the small group cannot be worked out.";
  if (reason === "complementary") return "Withheld because a neighbouring figure is too small to show.";
  return `A group is smaller than ${minimum}, so this figure is withheld.`;
}
