import { z } from "zod";

/**
 * The sponsor report as the database returns it (S38e, Module 22.6). Parsed, never trusted. A figure is either withheld (nothing about it is
 * shown) or carries its numbers. Nothing here holds a person. The CSV carries exactly what the page shows.
 */
const withheld = z.object({ suppressed: z.literal(true), reason: z.enum(["under_minimum", "small_cell"]), minimum: z.number().int(), n: z.number().int().optional() });
const bp = z.union([
  z.object({ suppressed: z.literal(false), n: z.number().int(), controlled: z.number().int(), uncontrolled: z.number().int(), insufficient_data: z.number().int(),
    rate_strict_pct: z.number(), rate_among_measured_pct: z.number().nullable().optional(), missing_pct: z.number() }),
  withheld,
]);
const members = z.union([z.object({ suppressed: z.literal(false), joined: z.number().int(), agreed_to_share: z.number().int(), agreed_pct: z.number() }), withheld]);
const change = z.union([z.object({ suppressed: z.literal(false), n: z.number().int(), mean_systolic_change: z.number(), mean_diastolic_change: z.number() }), withheld]);
const adherence = z.union([z.object({ suppressed: z.literal(false), n: z.number().int(), mean_pct: z.number() }), withheld]);
const engagement = z.union([z.object({ suppressed: z.literal(false), n: z.number().int(), logged_a_reading_in_30_days_pct: z.number() }), withheld]);

export const sponsorReportSchema = z.object({
  cohort: z.object({ name: z.string(), sponsor: z.string(), valid_from: z.string(), valid_to: z.string() }),
  minimum_cell: z.number().int(),
  members, bp_control_90d: bp, change_among_measured: change, adherence_separate: adherence, engagement_separate: engagement,
  range: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  definition: z.string(), limitations: z.string(), not_a_causal_claim: z.literal(true), generated_at: z.string(),
});
export type SponsorReport = z.infer<typeof sponsorReportSchema>;

export function parseSponsorReport(data: unknown): SponsorReport | null {
  const r = sponsorReportSchema.safeParse(data);
  return r.success ? r.data : null;
}

export const cohortListSchema = z.array(z.object({
  id: z.string().uuid(), name: z.string(), code: z.string(), sponsor: z.string(), valid_from: z.string(), valid_to: z.string(),
  max_uses: z.number().int(), uses: z.number().int(), status: z.enum(["active", "closed"]),
}));
export type CohortRow = z.infer<typeof cohortListSchema>[number];
export function parseCohortList(data: unknown): CohortRow[] {
  const r = cohortListSchema.safeParse(data);
  return r.success ? r.data : [];
}

export const withheldText = (w: z.infer<typeof withheld>): string =>
  w.reason === "under_minimum" ? `Fewer than ${w.minimum} people, so nothing is shown.` : `One group is smaller than ${w.minimum}, so the counts are withheld.`;

function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (...c: (string | number | null | undefined)[]) => c.map(cell).join(",");
const W = (name: string, w: z.infer<typeof withheld>) => [line(name, "status", "withheld"), line(name, "reason", w.reason), line(name, "minimum_group_size", w.minimum)];

export function sponsorReportToCsv(r: SponsorReport): string {
  const rows = [line("section", "item", "value"), line("report", "programme", r.cohort.name), line("report", "sponsor", r.cohort.sponsor), line("report", "minimum_group_size", r.minimum_cell),
    line("report", "range_from", r.range.from ?? "all"), line("report", "range_to", r.range.to ?? "all"), line("report", "generated_at", r.generated_at)];
  rows.push(...(r.members.suppressed ? W("members", r.members) : [line("members", "joined", r.members.joined), line("members", "agreed_to_share", r.members.agreed_to_share), line("members", "agreed_pct", r.members.agreed_pct)]));
  const b = r.bp_control_90d;
  rows.push(...(b.suppressed ? W("bp_control_90d", b) : [line("bp_control_90d", "people", b.n), line("bp_control_90d", "controlled", b.controlled), line("bp_control_90d", "not_controlled", b.uncontrolled),
    line("bp_control_90d", "no_or_too_few_readings", b.insufficient_data), line("bp_control_90d", "controlled_pct_of_everyone_due", b.rate_strict_pct),
    line("bp_control_90d", "controlled_pct_of_those_measured", b.rate_among_measured_pct ?? "withheld"), line("bp_control_90d", "missing_pct", b.missing_pct)]));
  const c = r.change_among_measured;
  rows.push(...(c.suppressed ? W("change_from_day_0", c) : [line("change_from_day_0", "people", c.n), line("change_from_day_0", "mean_systolic_change", c.mean_systolic_change), line("change_from_day_0", "mean_diastolic_change", c.mean_diastolic_change)]));
  const a = r.adherence_separate;
  rows.push(...(a.suppressed ? W("adherence_separate", a) : [line("adherence_separate", "people", a.n), line("adherence_separate", "mean_pct", a.mean_pct)]));
  const e = r.engagement_separate;
  rows.push(...(e.suppressed ? W("engagement_separate", e) : [line("engagement_separate", "people", e.n), line("engagement_separate", "logged_a_reading_in_30_days_pct", e.logged_a_reading_in_30_days_pct)]));
  rows.push(line("notes", "definition", r.definition), line("notes", "limitations", r.limitations), line("notes", "causal_claim", "none: this describes members who agreed to share and does not compare with a control group"));
  return rows.join("\r\n") + "\r\n";
}
