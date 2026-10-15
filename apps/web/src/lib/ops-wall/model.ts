import { z } from "zod";

/**
 * SR5: the operations wall. Every answer from `operations_wall()` is parsed here. The database decides who may read it and leaves out
 * every patient reference; a parse failure is a load failure on the screen, never a row of zeros.
 */
const queueRow = z.object({ priority_class: z.number().int(), waiting: z.number().int(), oldest_minutes: z.number().int().nullable(), past_due: z.number().int() });
const alertRow = z.object({
  rule: z.string(),
  title: z.string(),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
  minutes_open: z.number().int(),
  detail: z.record(z.string(), z.unknown()),
});
const channelRow = z.object({ channel: z.string(), sent: z.number().int(), failed: z.number().int(), pending: z.number().int() });

export const wallSchema = z.object({
  generated_at: z.string(),
  queue: z.array(queueRow),
  tasks_claimed: z.number().int(),
  pages: z.object({
    open: z.number().int(),
    unacknowledged: z.number().int(),
    oldest_unacknowledged_seconds: z.number().int(),
    sent_24h: z.number().int(),
  }),
  doctors_online: z.number().int(),
  on_call_covered: z.boolean(),
  calls_in_progress: z.number().int(),
  calls_waiting: z.number().int(),
  tests_this_week: z.object({ orders: z.number().int(), results_received: z.number().int(), results_held: z.number().int() }),
  notifications: z.array(channelRow),
  payments: z.object({
    events: z.number().int(),
    processed: z.number().int(),
    unprocessed: z.number().int(),
    errored: z.number().int(),
    taken_minor: z.number(),
  }),
  alerts: z.object({
    open: z.array(alertRow),
    rules_on: z.number().int(),
    rules_off: z.array(z.object({ rule: z.string(), reason: z.string().nullable() })),
    rules_failing: z.number().int(),
    last_evaluated_at: z.string().nullable(),
    contacts: z.number().int(),
  }),
  incidents_open: z.object({ sev1: z.number().int(), sev2: z.number().int() }),
});
export type Wall = z.infer<typeof wallSchema>;

/** Percentage of sends that failed among those that were attempted (sent or failed); null when nothing was attempted. */
export function failurePercent(c: { sent: number; failed: number }): number | null {
  const attempted = c.sent + c.failed;
  return attempted === 0 ? null : Math.round((1000 * c.failed) / attempted) / 10;
}

/** The evaluator is stale when it has never run or has not run for three minutes (it runs every minute). */
export function evaluatorStale(lastEvaluatedAt: string | null, now: Date): boolean {
  if (!lastEvaluatedAt) return true;
  return now.getTime() - new Date(lastEvaluatedAt).getTime() > 3 * 60 * 1000;
}

export function waitLabel(minutes: number | null): string {
  if (minutes === null) return "none waiting";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `${h} h ${minutes % 60} min`;
}
