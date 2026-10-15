import { z } from "zod";
import { en, t, type MessageKey } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";

/**
 * S35: the shapes the clinician queue, task view, patient summary and lead list read, parsed with Zod because the
 * generated types do not carry the newest functions. Pure: no clock of its own (callers pass `now`), no I/O.
 * A parse failure is shown as a load error, never as "nothing here".
 */

export const uuidSchema = z.string().uuid();

/**
 * Task types that have their own completion flow. A free-text "Mark as done" would close the task, and pay the fee,
 * without the patient getting their answer or call, so the generic outcome form is not offered for them (and the server
 * action refuses it). The value is where the clinician finishes the task.
 */
export const DEDICATED_FLOW_TASK_TYPES: Record<string, string> = {
  async_question: "/clinician/async-consults",
  written_question_call: "/clinician/async-consults",
};

export const offeredTaskSchema = z.object({
  task_id: z.string().uuid(),
  type: z.string(),
  priority_class: z.number().nullable(),
  due_at: z.string().nullable(),
  window_ends_at: z.string().nullable(),
});
export type OfferedTask = z.infer<typeof offeredTaskSchema>;

export const queueSummarySchema = z.object({
  open: z.boolean(),
  blocked: z.string().nullable().optional(),
  next_fee_kobo: z.number().nullable().optional(),
  by_class: z.record(z.string(), z.number()),
  // S16-S20: why the queue is closed and until when, work offered to me first, escalated work I can take, my own score
  cooling_off_until: z.string().nullable().optional(),
  offered: z.array(offeredTaskSchema).optional(),
  escalated_claimable: z.number().optional(),
  reliability_score: z.number().nullable().optional(),
});
export type QueueSummary = z.infer<typeof queueSummarySchema>;

/** One escalated task as the clinical lead sees it (public.queue_escalated_overview): ids and neutral facts, never a patient. */
export const escalatedTaskSchema = z.object({
  task_id: z.string().uuid(),
  type: z.string(),
  priority_class: z.number(),
  due_at: z.string().nullable(),
  escalated_at: z.string().nullable(),
  age_minutes: z.number().nullable(),
  escalation_level: z.number(),
  handback_count: z.number(),
});
export type EscalatedTask = z.infer<typeof escalatedTaskSchema>;

/** Why the queue is closed, in words. An unknown reason gets the general sentence, never a code. */
export function blockedReasonKey(blocked: string | null | undefined): MessageKey | null {
  if (!blocked) return null;
  const key = `queue.blocked.${blocked}`;
  return blocked !== "other" && key in en ? (key as MessageKey) : "queue.blocked.other";
}

/** The label for an outcome code; a code the catalogue does not know is shown with the generic label, never as a raw code. */
export function outcomeLabelKey(code: string): MessageKey {
  const key = `task.outcome.${code}`;
  return key in en ? (key as MessageKey) : "task.outcome_code";
}

export function attemptMethodLabelKey(method: string): MessageKey {
  const key = `task.attempt_method.${method}`;
  return key in en ? (key as MessageKey) : "task.attempt_method";
}

export const heldTaskSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  priority_class: z.number().nullable(),
  due_at: z.string().nullable(),
  claim_expires_at: z.string().nullable(),
  task_type_version: z.number().nullable().optional(),
  rule_set_version: z.number().nullable().optional(),
  patient_id: z.string().uuid(),
  state: z.string(),
});
export type HeldTask = z.infer<typeof heldTaskSchema>;

export const leadPatientsSchema = z.array(
  z.object({
    patient_id: z.string().uuid(),
    first_name: z.string().nullable(),
    last_bp: z.object({ systolic: z.number(), diastolic: z.number(), measured_at: z.string() }).nullable(),
    adherence_percent: z.number().nullable(),
    pending_proposals: z.number(),
    due_tasks: z.number(),
  }),
);
export type LeadPatient = z.infer<typeof leadPatientsSchema>[number];

const reading = z.object({
  type: z.string(),
  systolic: z.number().nullable(),
  diastolic: z.number().nullable(),
  value_numeric: z.number().nullable(),
  unit: z.string().nullable(),
  measured_at: z.string(),
  source: z.string().nullable(),
  /** P6: what the patient measured with (S12b). Absent on older summaries and when not recorded. */
  cuff_type: z.enum(["upper_arm", "wrist", "not_sure"]).nullable().optional(),
});

/** Every section is optional: a section the clinician may not read is simply absent (and named in `denied`). */
export const patientSummarySchema = z.object({
  status: z.enum(["ok", "partial", "denied"]),
  denied: z.array(z.string()).optional(),
  patient_first_name: z.string().nullable().optional(),
  readings: z
    .object({
      window_days: z.number(),
      rows: z.array(reading),
      targets: z.array(z.object({ condition: z.string(), target_ranges: z.unknown() })),
    })
    .optional(),
  triage_events: z
    .array(
      z.object({
        grade: z.string(),
        trigger_type: z.string(),
        explanation_key: z.string().nullable(),
        created_at: z.string(),
        /** P6: why the engine graded it - the rule, the rule set version and the facts it was given. */
        rule_id: z.string().nullable().optional(),
        rule_set_code: z.string().nullable().optional(),
        rule_set_version: z.number().nullable().optional(),
        matched_rule_ids: z.array(z.string()).optional(),
        context: z.unknown().nullable().optional(),
      }),
    )
    .optional(),
  medications: z
    .object({
      active: z.array(z.object({ id: z.string(), drug_name: z.string(), dose: z.string().nullable(), frequency: z.string().nullable() })),
      adherence: z.object({ percent: z.number().nullable(), due: z.number().optional() }).passthrough(),
    })
    .optional(),
  care_plan: z.array(z.object({ id: z.string(), condition: z.string(), status: z.string() }).passthrough()).optional(),
  pending_proposals: z.array(z.object({ id: z.string(), kind: z.string(), state: z.string(), created_at: z.string() }).passthrough()).optional(),
  signed_notes: z
    .array(z.object({ id: z.string(), encounter_type: z.string().nullable(), assessment: z.string().nullable(), plan: z.string().nullable(), finalized_at: z.string().nullable() }).passthrough())
    .optional(),
  results: z.array(z.object({ id: z.string(), panel_code: z.string().nullable(), release_state: z.string(), received_at: z.string() })).optional(),
  allergies: z.array(z.object({ allergen: z.string(), reaction: z.string().nullable(), severity: z.string().nullable() })).optional(),
  conditions: z.array(z.object({ condition_name: z.string(), status: z.string(), severity: z.string().nullable() })).optional(),
  care_circle: z.object({ active_members: z.number() }).optional(),
});
export type PatientSummary = z.infer<typeof patientSummarySchema>;

/** The reason written to the audit log when a clinician opens a summary from a task they hold. */
export const TASK_SUMMARY_READ_REASON = "Reviewing the patient summary for a task I hold";
export const LEAD_SUMMARY_READ_REASON = "Reviewing the patient summary for a patient I lead";

/** Whole minutes left on a claim, never negative; null when there is no expiry. */
export function minutesLeft(expiresAt: string | null | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 60_000));
}

/** Waiting counts in priority order, class 1 first, with a total. Unknown keys are kept, sorted after the numbers. */
export function classCounts(byClass: Record<string, number>): { rows: { key: string; count: number }[]; total: number } {
  const rows = Object.entries(byClass)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => {
      const an = Number(a.key);
      const bn = Number(b.key);
      if (Number.isNaN(an) || Number.isNaN(bn)) return a.key.localeCompare(b.key);
      return an - bn;
    });
  return { rows, total: rows.reduce((sum, r) => sum + r.count, 0) };
}

// ----- how a task is finished (S16-S20 D4) -------------------------------------------------------------------------------
// The outcome codes, the contact-attempt rule and the note limit are the PROPOSED `queue.task_layer` configuration, the same
// values the database reads (queue_task_layer_config); nothing here is a literal. The database is the enforcer and also checks
// the system record (a released result, a signed change, an acknowledged page); this only decides what the screen offers.

interface CompletionConfig {
  default_codes: readonly string[];
  codes_by_type: Readonly<Record<string, readonly string[]>>;
  contact_attempts: { min_attempts: number; methods: readonly string[] };
  note_max_chars: number;
}

function completionConfig(): CompletionConfig {
  return (getProposedConfig("queue.task_layer").value as unknown as { completion: CompletionConfig }).completion;
}

export interface CompletionOptions {
  codes: readonly string[];
  /** The code that asks for a documented sequence of contact attempts, if this task type has one. */
  attemptsCode: string | null;
  minAttempts: number;
  methods: readonly string[];
  noteMaxChars: number;
}

export const CONTACT_ATTEMPTS_CODE = "contact_attempts_documented";

export function completionOptions(type: string): CompletionOptions {
  const c = completionConfig();
  const codes = c.codes_by_type[type] ?? c.default_codes;
  return {
    codes,
    attemptsCode: codes.includes(CONTACT_ATTEMPTS_CODE) ? CONTACT_ATTEMPTS_CODE : null,
    minAttempts: c.contact_attempts.min_attempts,
    methods: c.contact_attempts.methods,
    noteMaxChars: c.note_max_chars,
  };
}

/**
 * Task types that are finished by the work itself, on another screen, against a record the database checks: signing the proposed
 * change closes a titration task, acknowledging the page closes a red event task. The generic form is not offered for them (and the
 * server action refuses it), because it could only offer a code the record would then refuse.
 */
export const SYSTEM_CLOSED_TASK_TYPES: Record<string, { href: (patientId: string) => string; messageKey: MessageKey; linkKey: MessageKey }> = {
  titration_signoff: {
    href: (patientId) => `/clinician/patients/${patientId}/care-plan-changes`,
    messageKey: "task.system_closed.titration_signoff",
    linkKey: "task.system_closed.titration_signoff_link",
  },
  red_event_unacknowledged: {
    href: () => "/clinician/on-call",
    messageKey: "task.system_closed.red_event_unacknowledged",
    linkKey: "task.system_closed.red_event_unacknowledged_link",
  },
  symptom_review: {
    href: () => "/clinician/consultations",
    messageKey: "task.system_closed.symptom_review",
    linkKey: "task.system_closed.symptom_review_link",
  },
};

export const attemptSchema = z.object({
  at: z.string().datetime({ offset: true }),
  method: z.string().min(1),
  reached: z.boolean(),
});
export type ContactAttemptInput = z.infer<typeof attemptSchema>;

/** A datetime-local value ("2026-10-14T13:05") is Lagos time; Lagos has no daylight saving, so the offset is fixed. */
export function lagosLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00+01:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface AttemptRow {
  method: string;
  reached: boolean;
  at: string;
}

/** Rows left blank are skipped; a row with a method but no readable time is dropped so the count check catches it. */
export function attemptsFromRows(rows: readonly AttemptRow[]): ContactAttemptInput[] {
  const out: ContactAttemptInput[] = [];
  for (const row of rows) {
    if (row.method === "") continue;
    const at = lagosLocalToIso(row.at);
    if (at !== null) out.push({ at, method: row.method, reached: row.reached });
  }
  return out;
}

export const completeTaskSchema = z.object({
  taskId: z.string().uuid(),
  code: z.string().trim().min(1, t("task.err.outcome_needed", "en")),
  note: z.string().trim().max(1000, t("task.err.note_long", "en")).optional(),
  attempts: z.array(attemptSchema).optional(),
});

export const SAFETY_CONCERN_CATEGORIES = [
  "patient_safety",
  "clinical_practice",
  "colleague_conduct",
  "system_or_process",
  "workload_or_staffing",
  "something_else",
] as const;
export const SAFETY_CONCERN_SEVERITIES = ["low", "medium", "high", "immediate"] as const;

export const safetyConcernSchema = z.object({
  category: z.enum(SAFETY_CONCERN_CATEGORIES),
  severity: z.enum(SAFETY_CONCERN_SEVERITIES),
  description: z.string().trim().min(20, t("concern.err.description", "en")).max(4000),
  screen: z.string().max(100).optional(),
  taskId: uuidSchema.optional(),
});

/**
 * Leads who need a doctor soonest come first: tasks due, then proposals waiting, then the lowest adherence (a patient
 * with no adherence figure sorts after one with a poor figure, and name breaks ties so the order is stable).
 */
export function rankLeadPatients(leads: LeadPatient[]): LeadPatient[] {
  return [...leads].sort(
    (a, b) =>
      b.due_tasks - a.due_tasks ||
      b.pending_proposals - a.pending_proposals ||
      (a.adherence_percent ?? 101) - (b.adherence_percent ?? 101) ||
      (a.first_name ?? "").localeCompare(b.first_name ?? ""),
  );
}

export type SlaState = { kind: "none" } | { kind: "overdue" } | { kind: "due"; minutes: number; warn: boolean };

/**
 * How a task's due time reads: overdue, or minutes left, and whether it is inside the warning window. The window is a
 * PROPOSED value (`queue.sla_warning`) passed in by the caller, never a literal here. The due time itself comes from the
 * task (set from the signed task type), so this only reports it.
 */
export function slaState(dueAt: string | null | undefined, now: Date, warnWithinMinutes?: number): SlaState {
  if (!dueAt) return { kind: "none" };
  const ms = new Date(dueAt).getTime() - now.getTime();
  if (Number.isNaN(ms)) return { kind: "none" };
  if (ms <= 0) return { kind: "overdue" };
  const minutes = Math.ceil(ms / 60_000);
  return { kind: "due", minutes, warn: warnWithinMinutes !== undefined && minutes <= warnWithinMinutes };
}
