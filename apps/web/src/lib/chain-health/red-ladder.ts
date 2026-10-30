import { z } from "zod";

/**
 * W-03: the red-page ladder read (public.red_ladder_status), parsed. A reply that does not match is "could not be read", never half a page of
 * healthy-looking numbers. Counts, seconds, stage names and clinician names only: no patient and no phone number appears here.
 */
const switchChange = z.object({ changed_at: z.string(), changed_by: z.string(), new_value: z.boolean(), reason: z.string() });

const coverageSchema = z.object({
  required_clinicians: z.number(),
  window_days: z.number(),
  distinct_on_rota: z.number(),
  distinct_credentialed_on_rota: z.number(),
  eligible_on_call_staff: z.number(),
  hours_total: z.number(),
  hours_covered: z.number(),
  hours_uncovered: z.number(),
  hours_without_backup: z.number(),
  self_granted_not_counted: z.number(),
  meets_minimum: z.boolean(),
  clinicians: z.array(z.object({ name: z.string(), shifts: z.number(), hours: z.number(), credentialed: z.boolean() })),
  sole_cmo_exception: z.object({
    sunset: z.string().nullable(),
    days_to_sunset: z.number().nullable(),
    in_force: z.boolean(),
    exception_ended: z.boolean(),
    expires_at: z.string().nullable(),
  }),
});

export const redLadderSchema = z.object({
  red_lane: z.object({
    enabled: z.boolean(),
    detection_budget_seconds: z.number(),
    inject_every_minutes: z.number(),
    last_judged_at: z.string().nullable(),
    last_passed: z.boolean().nullable(),
    last_stage: z.string().nullable(),
    runs_24h: z.number(),
    failures_24h: z.number(),
    blips_24h: z.number(),
  }),
  dead_letters: z.object({
    paging_enabled: z.boolean(),
    subscribers: z.array(z.string()),
    open: z.number(),
    unassigned: z.number(),
    paged_30d: z.number(),
  }),
  rota: coverageSchema,
  switch_changes: z.object({ red_lane: switchChange.nullable(), dead_letter_paging: switchChange.nullable() }),
  phone_fallbacks: z.object({
    expired_pages_30d: z.number(),
    expired_pages_without_call_30d: z.number(),
    calls_30d: z.number(),
    last_call_at: z.string().nullable(),
  }),
});
export type RedLadder = z.infer<typeof redLadderSchema>;

export function parseRedLadder(raw: unknown): RedLadder | null {
  const r = redLadderSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export type LadderConcern = { key: string; text: string; severe: boolean };

/**
 * What needs a person's eye. Switched-off checks are listed as concerns on purpose: a ladder nobody is drilling is not a healthy ladder, and
 * the page must not read "all clear" when a check is simply not running.
 */
export function ladderConcerns(l: RedLadder): LadderConcern[] {
  const out: LadderConcern[] = [];
  if (!l.red_lane.enabled) out.push({ key: "red_lane_off", text: "The three-minute red chain check is switched off, so a broken red path would only be found by the half-hourly check.", severe: false });
  else if (l.red_lane.last_passed === false) out.push({ key: "red_lane_failed", text: `The last three-minute red chain check failed${l.red_lane.last_stage ? ` (${l.red_lane.last_stage})` : ""}.`, severe: true });
  else if (l.red_lane.last_judged_at === null) out.push({ key: "red_lane_silent", text: "The three-minute red chain check is on but has not reported yet.", severe: false });
  if (!l.dead_letters.paging_enabled) out.push({ key: "dead_letter_off", text: "A failed red chain step does not yet phone anyone: paging the ops desk about dead letters is switched off.", severe: false });
  if (l.dead_letters.unassigned > 0) out.push({ key: "dead_letter_unassigned", text: `${l.dead_letters.unassigned} failed red chain step(s) have no ops person assigned. Phone the on-call clinician now.`, severe: true });
  else if (l.dead_letters.open > 0) out.push({ key: "dead_letter_open", text: `${l.dead_letters.open} failed red chain step(s) are still open on the ops desk.`, severe: true });
  if (!l.rota.meets_minimum) {
    out.push({
      key: "rota",
      text: `${l.rota.distinct_credentialed_on_rota} credentialed on-call clinician(s) on the rota of the ${l.rota.required_clinicians} required; ${l.rota.hours_uncovered} hour(s) of the next ${l.rota.window_days} days have nobody credentialed on call.`,
      severe: l.rota.hours_uncovered > 0,
    });
  }
  const sc = l.rota.sole_cmo_exception;
  if (sc.exception_ended && l.rota.self_granted_not_counted > 0) {
    out.push({
      key: "sole_cmo_ended",
      text: `The sole chief medical officer exception has ended. ${l.rota.self_granted_not_counted} clinician(s) who granted themselves the on-call competency no longer count towards cover.`,
      severe: !l.rota.meets_minimum,
    });
  } else if (sc.sunset && sc.days_to_sunset !== null && sc.days_to_sunset <= 30 && !l.rota.meets_minimum) {
    out.push({
      key: "sole_cmo",
      text: sc.days_to_sunset < 0 ? "The sole chief medical officer exception has ended and cover is still below the minimum." : `The sole chief medical officer exception ends in ${sc.days_to_sunset} day(s) and cover is still below the minimum.`,
      severe: sc.days_to_sunset <= 7,
    });
  }
  if (l.phone_fallbacks.expired_pages_without_call_30d > 0) out.push({ key: "phone", text: `${l.phone_fallbacks.expired_pages_without_call_30d} expired red page(s) in the last 30 days have no logged phone call.`, severe: true });
  return out;
}
