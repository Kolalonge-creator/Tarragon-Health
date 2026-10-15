import { z } from "zod";

/**
 * The care-team response report as the database returns it (S75 A6). Parsed, never trusted: a reply that does not match is shown as
 * "could not be read" instead of half-rendered numbers. Descriptive only: no target, no ranking, no comparison. Small groups are withheld
 * by the database; nothing here holds a person.
 */
const withheldMeasure = z.object({ suppressed: z.literal(true), reason: z.literal("under_minimum") });
const times = z.union([z.object({ median: z.number(), p90: z.number() }), withheldMeasure]);

const taskGroup = z.union([
  z.object({ task_type: z.string(), priority_class: z.number().int(), suppressed: z.literal(true), reason: z.literal("under_minimum") }),
  z.object({
    task_type: z.string(),
    priority_class: z.number().int(),
    suppressed: z.literal(false),
    time_to_claim_minutes: times,
    time_to_complete_minutes: times,
    overdue_open_now: z.number().int(),
    completed_after_due: z.number().int(),
  }),
]);

const pageGroup = z.union([
  z.object({ page_role: z.string(), suppressed: z.literal(true), reason: z.literal("under_minimum") }),
  z.object({
    page_role: z.string(),
    suppressed: z.literal(false),
    time_to_acknowledge_minutes: times,
    time_to_close_minutes: times,
    unacknowledged_open_now: z.number().int(),
  }),
]);

export const responseReportSchema = z.object({
  minimum_cell: z.number().int(),
  config_version: z.number().int().nullable(),
  range: z.object({ from: z.string(), to: z.string() }),
  tasks: z.array(taskGroup),
  task_groups_withheld: z.number().int(),
  pages: z.array(pageGroup),
  page_groups_withheld: z.number().int(),
  data_quality: z.object({
    members_with_a_bp_reading_last_30_days_pct: z.number().nullable().optional(),
    members_with_a_bp_reading_suppressed: z.boolean(),
    day90_snapshots_insufficient_data_pct: z.number().nullable().optional(),
    day90_snapshots_suppressed: z.boolean(),
  }),
  descriptive_only: z.literal(true),
  not_for_publication: z.literal(true),
  generated_at: z.string(),
});
export type ResponseReport = z.infer<typeof responseReportSchema>;
export type TaskGroup = z.infer<typeof taskGroup>;
export type PageGroup = z.infer<typeof pageGroup>;
export type Times = z.infer<typeof times>;

export function parseResponseReport(data: unknown): ResponseReport | null {
  const r = responseReportSchema.safeParse(data);
  return r.success ? r.data : null;
}

/** "11.5 min" for a number of minutes; longer spans read as hours or days. Null when withheld. */
export function minutesText(m: number): string {
  if (m < 90) return `${m.toFixed(1)} min`;
  if (m < 60 * 36) return `${(m / 60).toFixed(1)} hours`;
  return `${(m / 1440).toFixed(1)} days`;
}

export function timesText(t: Times, minimum: number): string {
  return "suppressed" in t ? `Fewer than ${minimum} cases, so nothing is shown.` : `typical ${minutesText(t.median)}, slowest tenth ${minutesText(t.p90)}`;
}
