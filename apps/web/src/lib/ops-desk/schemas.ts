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

export type WindowInput = { day: number; start: string; end: string };
export const windowSchema = z.object({ day: z.number().int().min(1).max(7), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) });

/** Windows as typed on the form: one per line like "1 08:00-18:00" (ISO day, 1 Monday to 7 Sunday, Lagos time). */
export function parseWindowLines(text: string): WindowInput[] {
  const out: WindowInput[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([1-7])\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(line);
    if (!m) throw new Error(`"${line}" is not a window. Write one per line like: 1 08:00-18:00 (1 is Monday, 7 is Sunday).`);
    const pad = (t: string): string => (t.length === 4 ? `0${t}` : t);
    out.push(windowSchema.parse({ day: Number(m[1]), start: pad(m[2] ?? ""), end: pad(m[3] ?? "") }));
  }
  return out;
}
