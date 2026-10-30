import { z } from "zod";

/**
 * The ops desk (OQ-441, decision S16-S20-10): the named ops person who phones the on-call clinician and the chief medical officer when a
 * red event page expires. These are the shapes of the database functions' answers; every read is parsed, never trusted.
 */
const iso = z.string().min(10);

export const WEEKDAY_LABEL: Record<number, string> = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };

export const rosterContactSchema = z.object({
  contact_id: z.uuid(),
  profile_id: z.uuid(),
  name: z.string(),
  role: z.enum(["primary", "deputy"]),
  is_active: z.boolean(),
  phone: z.string().nullable(),
  phone_status: z.enum(["confirmed", "not_confirmed", "no_number"]),
  on_duty_now: z.boolean(),
  activated_by_name: z.string().nullable(),
  activated_at: iso.nullable(),
  windows: z.array(z.object({ day: z.number().int().min(1).max(7), start: z.string(), end: z.string() })),
});
export type RosterContact = z.infer<typeof rosterContactSchema>;
export const rosterSchema = z.array(rosterContactSchema);

export const checklistItemSchema = z.object({
  item_key: z.string(),
  title: z.string(),
  detail: z.string(),
  state: z.enum(["in_place", "not_in_place", "not_attested"]),
  attested_at: iso.nullable(),
  attested_by_name: z.string().nullable(),
  evidence_note: z.string().nullable(),
  stale: z.boolean(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const overviewSchema = z.object({
  config_version: z.number().nullable(),
  checklist_gates_readiness: z.boolean(),
  ready: z.boolean(),
  checklist: z.array(checklistItemSchema),
  active_primary: z.number(),
  active_deputy: z.number(),
  on_duty_now: z.number(),
  uncovered_hours_next_7_days: z.number(),
  window_days: z.number(),
  assignments: z.number(),
  acknowledged: z.number(),
  moved_to_deputy: z.number(),
  median_seconds_to_acknowledge: z.number().nullable(),
  calls_logged: z.number(),
  calls_answered: z.number(),
  open_uncovered_incidents: z.number(),
});
export type OpsDeskOverview = z.infer<typeof overviewSchema>;

export const CALL_OUTCOMES = ["answered_acknowledged", "answered_will_acknowledge", "no_answer", "busy_or_off", "wrong_or_no_number", "voicemail_left"] as const;
export const callOutcomeSchema = z.enum(CALL_OUTCOMES);
export const CALL_OUTCOME_LABEL: Record<(typeof CALL_OUTCOMES)[number], string> = {
  answered_acknowledged: "Answered and acknowledged the page",
  answered_will_acknowledge: "Answered and will acknowledge now",
  no_answer: "No answer",
  busy_or_off: "Busy or phone off",
  wrong_or_no_number: "Wrong number or no number",
  voicemail_left: "Voicemail left",
};

export const CALLEE_KINDS = ["on_call_primary", "on_call_backup", "chief_medical_officer", "other"] as const;
export const calleeKindSchema = z.enum(CALLEE_KINDS);
export const CALLEE_KIND_LABEL: Record<(typeof CALLEE_KINDS)[number], string> = {
  on_call_primary: "On-call clinician",
  on_call_backup: "Backup on-call clinician",
  chief_medical_officer: "Chief medical officer",
  other: "Someone else",
};

export const callRowSchema = z.object({
  id: z.uuid(),
  incident_id: z.uuid(),
  incident_reference: z.string(),
  called_at: iso,
  called_by_name: z.string(),
  callee_kind: calleeKindSchema,
  callee_name: z.string(),
  callee_phone_masked: z.string().nullable(),
  outcome: callOutcomeSchema,
  note: z.string().nullable(),
});
export type CallRow = z.infer<typeof callRowSchema>;
export const callsSchema = z.array(callRowSchema);

export const callSheetSchema = z.object({
  incident_id: z.uuid(),
  reference: z.string(),
  opened_at: iso,
  page_acknowledged: z.boolean().default(false),
  people: z.array(
    z.object({
      kind: z.enum(["on_call_primary", "on_call_backup", "chief_medical_officer"]),
      profile_id: z.uuid(),
      name: z.string(),
      phone: z.string().nullable(),
      phone_status: z.enum(["confirmed", "no_confirmed_number"]),
    }),
  ),
});
export type CallSheet = z.infer<typeof callSheetSchema>;

/** Carries code 22023 so the form action shows the sentence to the person instead of the generic message. */
export class WindowParseError extends Error {
  readonly code = "22023";
  constructor(message: string) {
    super(message);
    this.name = "WindowParseError";
  }
}

export type WindowInput = { day: number; start: string; end: string };

const hhmm = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const windowSchema = z
  .object({ day: z.number().int().min(1).max(7), start: z.string().regex(hhmm), end: z.string().refine((v) => v === "24:00" || hhmm.test(v)) })
  .refine((w) => w.end > w.start, { message: "end after start" });

const nextDay = (d: number): number => (d % 7) + 1;
const pad = (t: string): string => (t.length === 4 ? `0${t}` : t);

/**
 * Windows as typed on the form, one per line, in Lagos time. ISO days: 1 Monday to 7 Sunday.
 *   `1 08:00-18:00`   a normal window (end may be 24:00 for midnight)
 *   `1 24h`           the whole day (00:00-24:00); `all 24h` is every day of the week
 *   `1 22:00-06:00`   a night: an end at or before the start runs into the next day, and is stored as two windows
 *                     (22:00-24:00 on day 1 and 00:00-06:00 on day 2) so there is no gap at midnight.
 */
export function parseWindowLines(text: string): WindowInput[] {
  const out: WindowInput[] = [];
  const bad = (line: string): never => {
    throw new WindowParseError(`"${line}" is not a window. Write one per line like: 1 08:00-18:00, 1 22:00-06:00 (a night) or 1 24h (1 is Monday, 7 is Sunday; "all 24h" is every day).`);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const whole = /^(all|[1-7])\s+24\s*h$/i.exec(line);
    if (whole) {
      const days = whole[1]?.toLowerCase() === "all" ? [1, 2, 3, 4, 5, 6, 7] : [Number(whole[1])];
      for (const day of days) out.push({ day, start: "00:00", end: "24:00" });
      continue;
    }
    const m = /^([1-7])\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(line);
    if (!m) return bad(line);
    const day = Number(m[1]);
    const start = pad(m[2] ?? "");
    const end = pad(m[3] ?? "");
    if (!hhmm.test(start) || !(end === "24:00" || hhmm.test(end))) return bad(line);
    if (end > start) {
      out.push({ day, start, end });
    } else if (end === "00:00" && start !== "00:00") {
      out.push({ day, start, end: "24:00" });
    } else if (end !== "24:00" && end <= start) {
      // overnight
      out.push({ day, start, end: "24:00" });
      if (end !== "00:00") out.push({ day: nextDay(day), start: "00:00", end });
    } else {
      return bad(line);
    }
  }
  return out;
}

/** A number as typed: +country code and digits, or a Nigerian 0 number. Anything else is refused here before the database sees it. */
export function toE164ForTestCall(raw: string): string | null {
  const compact = raw.replace(/[\s()-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^0\d{10}$/.test(compact)) return `+234${compact.slice(1)}`;
  return null;
}
