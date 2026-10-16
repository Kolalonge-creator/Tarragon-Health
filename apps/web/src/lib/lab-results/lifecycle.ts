import { z } from "zod";

/**
 * S27h: narrow parsers and plain-words helpers for the lab lifecycle screens (preliminary results, the critical value call, the
 * hold clock, the delta flags and the patient trend). No server-only imports. Nothing here decides a release: every number is a
 * display of what the database already holds, and a parse failure shows an error, never an empty "all clear".
 */

export const deltaFlagSchema = z.object({
  analyte_code: z.string(),
  current: z.number(),
  previous: z.number(),
  previous_released_at: z.string(),
  percent_change: z.number().nullable(),
  threshold_percent: z.number(),
});
export type DeltaFlag = z.infer<typeof deltaFlagSchema>;

export const reviewContextSchema = z.object({
  report_status: z.enum(["preliminary", "final"]),
  corrects_preliminary: z.boolean(),
  delta_flags: z.array(deltaFlagSchema),
  critical_call: z
    .object({
      call_id: z.string().uuid(),
      called_at: z.string(),
      due_at: z.string(),
      acknowledged_at: z.string().nullable(),
      closed_at: z.string().nullable(),
      overdue: z.boolean(),
      no_cover: z.boolean(),
    })
    .nullable(),
  hold: z.object({ received_at: z.string(), expected_at: z.string(), lead_escalated: z.boolean() }),
});
export type ReviewContext = z.infer<typeof reviewContextSchema>;

export const holdClockSchema = z.array(
  z.object({
    lab_result_id: z.string().uuid(),
    release_state: z.string(),
    report_status: z.enum(["preliminary", "final"]),
    received_at: z.string(),
    expected_at: z.string(),
    lead_escalation_at: z.string().nullable(),
    minutes_waiting: z.number(),
    past_expected: z.boolean(),
    lead_escalated: z.boolean(),
  }),
);
export type HoldClockRow = z.infer<typeof holdClockSchema>[number];

export const criticalCallsSchema = z.array(
  z.object({
    call_id: z.string().uuid(),
    lab_result_id: z.string().uuid(),
    called_at: z.string(),
    due_at: z.string(),
    acknowledged_at: z.string().nullable(),
    minutes_open: z.number(),
    overdue: z.boolean(),
    my_role: z.enum(["called", "backup", "lead"]),
    no_cover: z.boolean(),
  }),
);
export type CriticalCallRow = z.infer<typeof criticalCallsSchema>[number];

export const trendNoteSchema = z.object({
  resultId: z.string().uuid(),
  analyte: z.string().regex(/^[a-z][a-z0-9_]*$/),
  note: z.string().trim().min(3, "Please write a few words.").max(300, "Please keep it to 300 characters."),
});

export const myTrendsSchema = z.array(
  z.object({
    analyte_code: z.string(),
    unit: z.string(),
    latest: z.object({ value: z.number(), released_at: z.string() }),
    previous: z.object({ value: z.number(), released_at: z.string() }),
    direction: z.enum(["higher", "lower", "same"]),
    note: z.string().nullable(),
  }),
);
export type MyTrend = z.infer<typeof myTrendsSchema>[number];

export const turnaroundOverviewSchema = z.array(
  z.object({
    provider_id: z.string().uuid(),
    provider_name: z.string(),
    is_active: z.boolean(),
    specimens_in_flight: z.number(),
    open_delay_alerts: z.number(),
    oldest_open_alert_hours: z.number().nullable(),
    rejected_30d: z.number(),
    recollections_open: z.number(),
    completed_30d: z.number(),
    median_hours_to_complete_30d: z.number().nullable(),
  }),
);
export type TurnaroundRow = z.infer<typeof turnaroundOverviewSchema>[number];

/** "3 h 20 min" / "45 min" / "2 days 4 h": the clinician's clock, in words. */
export function formatWaiting(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 60 * 48) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
  }
  const d = Math.floor(m / (60 * 24));
  const h = Math.floor((m % (60 * 24)) / 60);
  return h === 0 ? `${d} days` : `${d} days ${h} h`;
}

/** The analyte as a person would say it. */
export function analyteLabel(code: string): string {
  return code.replace(/_/g, " ");
}

/** The three plain direction words, never a verdict. */
export const TREND_DIRECTION_WORD: Record<MyTrend["direction"], string> = {
  higher: "Higher than last time",
  lower: "Lower than last time",
  same: "The same as last time",
};

/** Maps the stable error codes of the S27h functions to plain words. */
const MESSAGES: Record<string, string> = {
  lab_trend_note_length: "Please write between 3 and 300 characters.",
  lab_trend_note_result_not_current: "A note can be added only to a released result that has not been replaced.",
  lab_trend_note_analyte_not_allowed: "A note cannot be added to that test.",
  lab_critical_call_not_found: "That call could not be found.",
  lab_finalise_needs_a_preliminary_result: "A final result can only replace a preliminary one.",
  lab_result_preliminary_not_releasable: "A preliminary result cannot be released. Wait for the final one.",
};

export function describeLifecycleError(error: { message?: string } | null | undefined, fallback = "That did not work. Please try again."): string {
  const m = error?.message ?? "";
  for (const [code, text] of Object.entries(MESSAGES)) if (m.includes(code)) return text;
  if (m.includes("This action is for clinicians")) return "This action is for clinicians.";
  return fallback;
}
