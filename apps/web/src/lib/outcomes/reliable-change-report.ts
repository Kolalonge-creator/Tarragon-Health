import { z } from "zod";

/**
 * The PHQ-9 / GAD-7 reliable change report as the database returns it (D4). Parsed, never trusted: a reply that does not match is shown as
 * "not available" instead of half-rendered numbers. A category that is withheld has no number in the reply, so none can be drawn here.
 * Group figures only: nothing in the reply names a person, and nothing here reads or asks for a single answer or a safety flag.
 */
const awaiting = z.object({ withheld: z.literal(true), reason: z.enum(["awaiting_cmo_signature", "measures_not_active"]), measure: z.string().optional() });

const cellShown = z.object({ key: z.string(), suppressed: z.literal(false), n: z.number().int(), pct_of_group: z.number() });
const cellWithheld = z.object({ key: z.string(), suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() });
const reliableChange = z.union([
  z.object({ suppressed: z.literal(true), reason: z.string(), minimum: z.number().int() }),
  z.object({ suppressed: z.literal(false), n: z.number().int(), categories: z.array(z.union([cellShown, cellWithheld])) }),
]);

const rate = z.union([
  z.object({ suppressed: z.literal(true), reason: z.string(), minimum: z.number().int(), n: z.number().int().optional() }),
  z.object({
    suppressed: z.literal(false), n: z.number().int(), reached: z.number().int(), not_reached: z.number().int(), insufficient_data: z.number().int(),
    rate_strict_pct: z.number(), rate_among_measured_pct: z.number().nullable().optional(), missing_pct: z.number(),
  }),
]);

export const reliableChangeReportSchema = z.union([
  awaiting,
  z.object({
    measure: z.enum(["phq9", "gad7"]),
    day: z.number().int(),
    config_version: z.number().int(),
    reliable_change_config_version: z.number().int(),
    minimum_cell: z.number().int(),
    reliable_change_points: z.number().int(),
    reliable_change: reliableChange,
    response: rate,
    remission: rate,
    group: z.string(),
    source: z.string(),
    note: z.string(),
    comparison_group: z.literal("none"),
    not_a_causal_claim: z.literal(true),
  }),
]);
export type ReliableChangeReport = z.infer<typeof reliableChangeReportSchema>;

export function parseReliableChangeReport(data: unknown): ReliableChangeReport | null {
  const r = reliableChangeReportSchema.safeParse(data);
  return r.success ? r.data : null;
}
export const isReliableChangeWithheld = (r: ReliableChangeReport): r is z.infer<typeof awaiting> => "withheld" in r;

export function reliableChangeWithheldText(reason: "awaiting_cmo_signature" | "measures_not_active"): string {
  return reason === "measures_not_active"
    ? "The outcome measures have not been switched on yet, so there is nothing to show."
    : "Awaiting the Chief Medical Officer's signature of the reliable change definition. Nothing is counted until then.";
}

/** Plain-words reason a figure is not shown. Never hints at a number. */
export function cellWithheldText(reason: string, minimum: number): string {
  if (reason === "under_minimum") return `Fewer than ${minimum} people, so nothing is shown.`;
  if (reason === "complementary") return "Withheld because a neighbouring figure is too small to show.";
  return `A group is smaller than ${minimum}, so this figure is withheld.`;
}

const LABELS: Record<string, string> = {
  reliable_improvement: "Reliable improvement",
  no_reliable_change: "No reliable change",
  reliable_deterioration: "Reliable deterioration",
  insufficient_data: "No follow-up score",
};
export const categoryLabel = (key: string): string => LABELS[key] ?? key;

/** The instruments and days the admin screen asks for. A day the live config does not list is refused by the database and shown as not available. */
export const RELIABLE_CHANGE_REQUESTS = [
  { measure: "phq9", day: 90, title: "PHQ-9 at day 90" },
  { measure: "phq9", day: 180, title: "PHQ-9 at day 180" },
  { measure: "gad7", day: 90, title: "GAD-7 at day 90" },
  { measure: "gad7", day: 180, title: "GAD-7 at day 180" },
] as const;
