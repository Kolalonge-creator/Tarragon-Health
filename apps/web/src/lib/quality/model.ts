import { z } from "zod";

/**
 * S36c: the clinical lead's quality screens over the S20 functions (docs/design/S20.md section 6). Every answer is parsed here;
 * the database re-checks who may read or write, and computes the score and outcome itself, so nothing on this page decides a result.
 */
export const auditRowSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  clinician_name: z.string().nullable(),
  reviewer_id: z.string().uuid().nullable(),
  reason: z.string(),
  state: z.string(),
  due_at: z.string().nullable(),
  overdue: z.boolean().nullable(),
  outcome: z.string().nullable(),
  total_score: z.number().nullable(),
  critical_miss: z.boolean().nullable(),
  followup_needed: z.boolean().nullable(),
  counts_toward_tier1: z.boolean().nullable(),
  submitted_at: z.string().nullable(),
});
export type AuditRow = z.infer<typeof auditRowSchema>;
export const auditRowsSchema = z.array(auditRowSchema);

export const handbackRowSchema = z.object({
  id: z.string().uuid(),
  clinician_id: z.string().uuid(),
  clinician_name: z.string().nullable(),
  state: z.string(),
  window_days: z.number().int().nullable(),
  handbacks: z.number().int().nullable(),
  reasons: z.record(z.string(), z.number()).nullable(),
  opened_at: z.string(),
  outcome: z.string().nullable(),
  reliability_score: z.number().nullable(),
});
export type HandbackRow = z.infer<typeof handbackRowSchema>;
export const handbackRowsSchema = z.array(handbackRowSchema);

export const caseFileSchema = z.object({
  audit: z.object({ id: z.string().uuid(), reason: z.string(), state: z.string(), due_at: z.string().nullable(), form_version: z.number().int() }),
  form: z.object({
    safety_items: z.array(z.string()).min(1),
    quality_items: z.array(z.string()).min(1),
    quality_max: z.number().int().positive(),
  }),
  task: z.object({
    id: z.string().uuid(),
    type: z.string().nullable(),
    priority_class: z.number().nullable(),
    created_at: z.string().nullable(),
    due_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    handback_count: z.number().nullable(),
    patient_id: z.string().uuid().nullable(),
    outcome: z.string().nullable(),
  }),
});
export type CaseFile = z.infer<typeof caseFileSchema>;

export const HANDBACK_OUTCOMES = ["no_action", "coaching", "competency_check", "capacity_issue", "concern_raised"] as const;
export type HandbackOutcome = (typeof HANDBACK_OUTCOMES)[number];

/** `consent_confirmed` becomes "Consent confirmed". The items are the CMO's own words in quality_config; this only tidies them. */
export function itemLabel(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

export type AuditPayload =
  | { ok: true; safety: Record<string, boolean>; quality: Record<string, number>; rationale: string }
  | { ok: false; error: "missing_item" | "bad_score" };

/**
 * Reads the audit form. A safety item must be answered pass or fail (nothing is assumed), a quality item must be a whole number
 * from 0 to the form's maximum. Anything missing stops here, so a half-filled form never reaches the database as a pass.
 */
export function parseAuditForm(
  data: { get(name: string): FormDataEntryValue | null },
  form: CaseFile["form"],
): AuditPayload {
  const safety: Record<string, boolean> = {};
  for (const item of form.safety_items) {
    const v = data.get(`safety:${item}`);
    if (v !== "pass" && v !== "fail") return { ok: false, error: "missing_item" };
    safety[item] = v === "pass";
  }
  const quality: Record<string, number> = {};
  for (const item of form.quality_items) {
    const raw = data.get(`quality:${item}`);
    if (typeof raw !== "string" || raw.trim() === "") return { ok: false, error: "missing_item" };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > form.quality_max) return { ok: false, error: "bad_score" };
    quality[item] = n;
  }
  const rationale = String(data.get("rationale") ?? "").trim();
  return { ok: true, safety, quality, rationale };
}

/** Notices carried in the address are one of these fixed tokens, so a link can never put its own words on the page. */
export const NOTICES = ["audit_submitted", "audit_failed", "audit_incomplete", "review_closed", "review_failed"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => (NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null;

export function dueLabel(row: Pick<AuditRow, "state" | "overdue">): "overdue" | "unassigned" | "open" | "done" {
  if (row.state === "submitted" || row.state === "closed") return "done";
  if (row.overdue) return "overdue";
  return row.state === "unassigned" ? "unassigned" : "open";
}
