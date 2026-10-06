import { z } from "zod";

/**
 * S35: the shapes the clinician queue, task view, patient summary and lead list read, parsed with Zod because the
 * generated types do not carry the newest functions. Pure: no clock of its own (callers pass `now`), no I/O.
 * A parse failure is shown as a load error, never as "nothing here".
 */

export const queueSummarySchema = z.object({
  open: z.boolean(),
  blocked: z.string().nullable().optional(),
  next_fee_kobo: z.number().nullable().optional(),
  by_class: z.record(z.string(), z.number()),
});
export type QueueSummary = z.infer<typeof queueSummarySchema>;

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
    .array(z.object({ grade: z.string(), trigger_type: z.string(), explanation_key: z.string().nullable(), created_at: z.string() }))
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

export const completeTaskSchema = z.object({
  taskId: z.string().uuid(),
  note: z.string().trim().min(10, "Please write what you did (10 characters or more).").max(1000, "Please keep this under 1,000 characters."),
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
  description: z.string().trim().min(20, "Please write at least 20 characters.").max(4000),
  screen: z.string().max(100).optional(),
  taskId: z.string().uuid().optional(),
});
