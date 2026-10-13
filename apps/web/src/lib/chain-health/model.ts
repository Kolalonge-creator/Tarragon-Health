import { z } from "zod";

/**
 * P1: the clinical chain health read (public.chain_health) and the reliability report (public.chain_reliability_report), parsed.
 * A reply that does not match is shown as "could not be read", never as half a page of healthy-looking numbers. Nothing here holds
 * a patient: the database returns counts, seconds and stage names only.
 */
const timing = z.object({ n: z.number(), withheld: z.boolean(), p50: z.number().optional(), p95: z.number().optional() });
export type Timing = z.infer<typeof timing>;

const parityRow = z.object({ engine_status: z.string(), engine_grade: z.string(), legacy_class: z.string(), readings: z.number() });

export const chainHealthSchema = z.object({
  generated_at: z.string(),
  status: z.enum(["ok", "attention", "down"]),
  reasons: z.array(z.string()),
  thresholds: z.record(z.string(), z.number()),
  canary: z.object({
    last_result_at: z.string().nullable(),
    last_passed: z.boolean().nullable(),
    last_failed_stage: z.string().nullable(),
    last_pass_at: z.string().nullable(),
    minutes_since_last_result: z.number().nullable(),
    runs_24h: z.number(),
    failures_24h: z.number(),
    recent: z.array(z.object({ at: z.string(), passed: z.boolean(), stage: z.string().nullable() })),
  }),
  bus: z.object({
    subscribers: z.array(z.object({ subscriber: z.string(), pending: z.number(), processing: z.number(), dead: z.number(), oldest_pending_seconds: z.number() })),
    stuck: z.number(),
    dead: z.number(),
  }),
  timings_7d: z.object({ reading_to_graded: timing, graded_to_task: timing, graded_to_page: timing, page_to_ack: timing }),
  canary_timings_7d: z.object({ reading_to_graded: timing, graded_to_page: timing, page_to_ack: timing }),
  parity_30d: z.array(parityRow),
});
export type ChainHealth = z.infer<typeof chainHealthSchema>;

export function parseChainHealth(raw: unknown): ChainHealth | null {
  const r = chainHealthSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export const reliabilitySchema = z.object({
  days: z.number(),
  minSample: z.number(),
  timings: z.object({ reading_to_graded: timing, graded_to_task: timing, task_to_claim: timing, graded_to_page: timing, page_to_ack: timing }),
  act_rate: z.object({ due: z.number(), completed: z.number(), completed_on_time: z.number(), withheld: z.boolean() }),
  page_ack: z.object({ pages: z.number(), acknowledged: z.number(), withheld: z.boolean() }),
  push_open_by_make: z.array(z.union([
    z.object({ make: z.string().nullable(), withheld: z.literal(true), under: z.number() }),
    z.object({ make: z.string().nullable(), sent: z.number(), opened: z.number(), open_rate: z.number() }),
  ])),
  credential_coverage: z.object({
    active_staff: z.number(), licence_date_held: z.number(), indemnity_required: z.number(), indemnity_date_held_where_required: z.number(),
    licence_expired: z.number(), licence_expires_within_30_days: z.number(), verification_recorded: z.number(),
  }),
  limits: z.array(z.string()),
});
export type Reliability = z.infer<typeof reliabilitySchema>;

export function parseReliability(raw: unknown): Reliability | null {
  const r = reliabilitySchema.safeParse(raw);
  return r.success ? r.data : null;
}

export const STATUS_LABEL: Record<ChainHealth["status"], string> = {
  ok: "Working",
  attention: "Needs a look",
  down: "Not working",
};

/** "42 seconds", "3 min 5 s", "2 h 10 min". */
export function formatSeconds(s: number): string {
  const n = Math.round(s);
  if (n < 120) return `${n} seconds`;
  if (n < 7200) return `${Math.floor(n / 60)} min ${n % 60} s`;
  return `${Math.floor(n / 3600)} h ${Math.floor((n % 3600) / 60)} min`;
}

export function describeTiming(t: Timing): string {
  if (t.n === 0) return "no events yet";
  if (t.withheld) return `${t.n} so far, too few to show a typical time`;
  return `typical ${formatSeconds(t.p50 ?? 0)}, slowest 1 in 20 ${formatSeconds(t.p95 ?? 0)} (${t.n} events)`;
}

export type ParityGroup = "both_urgent" | "engine_stricter" | "engine_red_legacy_quiet" | "legacy_urgent_engine_not_red" | "neither_urgent";

export const PARITY_TEXT: Record<ParityGroup, { title: string; note: string; concern: boolean }> = {
  both_urgent: { title: "Both raised it urgently", note: "The new grading and the old alert agree.", concern: false },
  engine_stricter: { title: "New grading red, old alert asked only for a review", note: "The new grading was stricter. Check these are right.", concern: false },
  engine_red_legacy_quiet: { title: "New grading red, old alert did nothing", note: "Look at these first: the old system did not act on a red.", concern: true },
  legacy_urgent_engine_not_red: {
    title: "Old alert urgent, new grading not red",
    note: "Expected for a very high reading with no symptoms (repeat first, then a review: CMO decision Q2). Check any others.",
    concern: true,
  },
  neither_urgent: { title: "Neither raised it urgently", note: "Both calm.", concern: false },
};

export function parityGroup(engineGrade: string, legacyClass: string): ParityGroup {
  const legacyUrgent = legacyClass === "emergency" || legacyClass === "priority1";
  if (engineGrade === "red") {
    if (legacyUrgent) return "both_urgent";
    return legacyClass === "review" ? "engine_stricter" : "engine_red_legacy_quiet";
  }
  return legacyUrgent ? "legacy_urgent_engine_not_red" : "neither_urgent";
}

export function groupParity(rows: ChainHealth["parity_30d"]): Array<{ group: ParityGroup; readings: number; draft: number }> {
  const order: ParityGroup[] = ["both_urgent", "engine_stricter", "engine_red_legacy_quiet", "legacy_urgent_engine_not_red", "neither_urgent"];
  const acc = new Map<ParityGroup, { readings: number; draft: number }>(order.map((g) => [g, { readings: 0, draft: 0 }]));
  for (const r of rows) {
    const g = acc.get(parityGroup(r.engine_grade, r.legacy_class));
    if (!g) continue;
    g.readings += r.readings;
    if (r.engine_status === "draft") g.draft += r.readings;
  }
  return order.map((group) => ({ group, ...(acc.get(group) as { readings: number; draft: number }) }));
}

export const STAGE_TEXT: Record<string, string> = {
  graded: "grading did not happen in time (the event processor or the grading step)",
  graded_wrong_grade: "the grading gave a different grade than the fixture expects",
  graded_shadow: "the grading used a rule set that is not approved",
  event_emitted: "the graded event was not recorded",
  event_delivered: "the graded event was not handled by the task or paging step",
  task: "no task was made for the amber reading",
  page: "no page reached the on-call clinician",
  notification: "no page notice was recorded",
  notification_not_neutral: "the page notice carried more than it may (a reading or a forbidden word)",
  ack: "the page was not acknowledged",
  unexpected_page: "an amber reading made a page",
  start: "the check could not insert its test reading",
  evaluate: "the check itself failed",
  stale: "the check stopped reporting",
};

export function stageText(stage: string | null): string {
  if (!stage) return "";
  return STAGE_TEXT[stage] ?? stage;
}
