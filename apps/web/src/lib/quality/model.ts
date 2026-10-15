import { z } from "zod";

/**
 * S36c and S20 v2: the clinical lead's quality screens over the S20 functions (docs/design/S20.md section 6, docs/design/S16-S20-quality-v2.md).
 * Every answer is parsed here; the database re-checks who may read or write, and computes the score and outcome itself, so nothing on this
 * page decides a result.
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
  // v2
  second_review_required: z.boolean().nullish(),
  second_reviewer_id: z.string().uuid().nullish(),
  final: z.boolean().nullish(),
  final_outcome: z.string().nullish(),
  second_review_agrees: z.boolean().nullish(),
  scribe_assisted: z.boolean().nullish(),
  avoidability: z.string().nullish(),
  replies: z.number().int().nullish(),
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

/** The form as stored with the audit's config version. The phases, avoidability and scribe items exist from form version 2. */
export const formSchema = z.object({
  safety_items: z.array(z.string()).min(1),
  quality_items: z.array(z.string()).min(1),
  quality_max: z.number().int().positive(),
  phases: z.array(z.string()).optional(),
  phase_comment_max_chars: z.number().int().positive().optional(),
  avoidability: z.object({ scale: z.array(z.string()).min(1), required_unless_outcome: z.string().optional() }).optional(),
  scribe_items: z.array(z.string()).optional(),
  scribe_critical_items: z.array(z.string()).optional(),
});
export type AuditFormSpec = z.infer<typeof formSchema>;

const messageSchema = z.object({ from: z.string(), by_audited_clinician: z.boolean().nullish(), body: z.string(), at: z.string() });

/**
 * The case file is clinical content read through an audited read. The patient is a pseudonymous reference and an age: the database sends
 * no id, name or phone, and nothing here asks for one.
 */
export const caseFileSchema = z.object({
  audit: z.object({
    id: z.string().uuid(),
    reason: z.string(),
    state: z.string(),
    due_at: z.string().nullable(),
    form_version: z.number().int(),
    opened_as: z.enum(["first", "second"]).optional(),
    scribe_assisted: z.boolean().optional(),
  }),
  form: formSchema,
  patient: z.object({ ref: z.string(), age_band: z.string().nullable() }).optional(),
  task: z.object({
    id: z.string().uuid(),
    type: z.string().nullable(),
    priority_class: z.number().nullable(),
    created_at: z.string().nullable(),
    due_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    handback_count: z.number().nullable(),
    outcome: z.unknown().nullable(),
  }),
  trigger: z.record(z.string(), z.unknown()).nullish(),
  reading: z.record(z.string(), z.unknown()).nullish(),
  messages: z.array(messageSchema).optional(),
  scribe_note: z.record(z.string(), z.unknown()).nullish(),
});
export type CaseFile = z.infer<typeof caseFileSchema>;

export const auditDetailSchema = z.object({
  id: z.string().uuid(),
  state: z.string(),
  outcome: z.string().nullable(),
  final_outcome: z.string().nullable(),
  total_score: z.number().nullable(),
  rationale: z.string().nullable(),
  phase_comments: z.record(z.string(), z.string()).nullable(),
  avoidability: z.string().nullable(),
  scribe_results: z.record(z.string(), z.boolean()).nullable(),
  second_review_required: z.boolean(),
  second_review_agrees: z.boolean().nullable(),
  replies: z.array(z.object({ body: z.string(), at: z.string() })),
  followups: z.array(z.object({ kind: z.string(), note: z.string(), at: z.string() })),
});
export type AuditDetail = z.infer<typeof auditDetailSchema>;

export const tier1Schema = z.object({
  clinical_staff_id: z.string().uuid(),
  level: z.number().int(),
  target: z.number().int(),
  audited: z.number().int(),
  submitted: z.number().int(),
  average_score: z.number().nullable(),
  critical_misses: z.number().int(),
  graduation_min_score: z.number(),
});
export type Tier1Progress = z.infer<typeof tier1Schema>;

/** What the audited clinician sees of themselves: finished audits only, the tier 1 count and the advisory reliability score. */
export const mySummarySchema = z.object({
  reliability_score: z.number().nullable(),
  level: z.number().int(),
  tier1: tier1Schema.nullable(),
  audits: z.array(z.object({
    id: z.string().uuid(),
    reason: z.string(),
    outcome: z.string().nullable(),
    total_score: z.number().nullable(),
    rationale: z.string().nullable(),
    phase_comments: z.record(z.string(), z.string()).nullable(),
    avoidability: z.string().nullable(),
    submitted_at: z.string().nullable(),
    final_at: z.string().nullable(),
    replies: z.array(z.object({ body: z.string(), at: z.string() })),
  })),
});
export type MyQualitySummary = z.infer<typeof mySummarySchema>;

export const staffOptionSchema = z.object({ profile_id: z.string().uuid().nullable(), id: z.string().uuid(), full_name: z.string().nullable(), doctor_tier: z.string().nullable(), credentialing_level: z.number().nullable() });
export const staffOptionsSchema = z.array(staffOptionSchema);
export type StaffOption = z.infer<typeof staffOptionSchema>;

export const HANDBACK_OUTCOMES = ["no_action", "coaching", "competency_check", "capacity_issue", "concern_raised"] as const;
export type HandbackOutcome = (typeof HANDBACK_OUTCOMES)[number];

/** `consent_confirmed` becomes "Consent confirmed". The items are the CMO's own words in quality_config; this only tidies them. */
export function itemLabel(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

export type AuditPayload =
  | {
      ok: true;
      safety: Record<string, boolean>;
      quality: Record<string, number>;
      rationale: string;
      /** Only present when the stored form has phases and at least one comment was written. */
      phaseComments?: Record<string, string>;
      /** Only present when the stored form has an avoidability rating. */
      avoidability?: string;
      /** Only present when the audit is of a scribe-drafted note and the form has scribe items. */
      scribe?: Record<string, boolean>;
    }
  | { ok: false; error: "missing_item" | "bad_score" | "missing_scribe" | "bad_avoidability" };

/**
 * Reads the audit form. A safety item must be answered pass or fail (nothing is assumed), a quality item must be a whole number
 * from 0 to the form's maximum. Anything missing stops here, so a half-filled form never reaches the database as a pass.
 * `scribeAssisted` is the audit's own flag: when true and the form has scribe items, each must be answered too.
 */
export function parseAuditForm(
  data: { get(name: string): FormDataEntryValue | null },
  form: AuditFormSpec,
  scribeAssisted = false,
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
  const result: Extract<AuditPayload, { ok: true }> = { ok: true, safety, quality, rationale };

  if (form.phases && form.phases.length > 0) {
    const max = form.phase_comment_max_chars ?? 2000;
    const comments: Record<string, string> = {};
    for (const phase of form.phases) {
      const text = String(data.get(`phase:${phase}`) ?? "").trim().slice(0, max);
      if (text !== "") comments[phase] = text;
    }
    if (Object.keys(comments).length > 0) result.phaseComments = comments;
  }
  if (form.avoidability) {
    const raw = String(data.get("avoidability") ?? "");
    if (raw !== "") {
      if (!form.avoidability.scale.includes(raw)) return { ok: false, error: "bad_avoidability" };
      result.avoidability = raw;
    }
  }
  if (scribeAssisted && form.scribe_items && form.scribe_items.length > 0) {
    const scribe: Record<string, boolean> = {};
    for (const item of form.scribe_items) {
      const v = data.get(`scribe:${item}`);
      if (v !== "pass" && v !== "fail") return { ok: false, error: "missing_scribe" };
      scribe[item] = v === "pass";
    }
    result.scribe = scribe;
  }
  return result;
}

/** The trailing arguments of `submit_clinical_audit` / `submit_second_audit_review`, sent only when the stored form defined them. */
export function extraRpcArgs(p: Extract<AuditPayload, { ok: true }>, second: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.phaseComments) out.p_phase_comments = p.phaseComments;
  if (p.scribe) out.p_scribe = p.scribe;
  if (!second && p.avoidability) out.p_avoidability = p.avoidability;
  return out;
}

/** Notices carried in the address are one of these fixed tokens, so a link can never put its own words on the page. */
export const NOTICES = [
  "audit_submitted",
  "audit_failed",
  "audit_incomplete",
  "review_closed",
  "review_failed",
  "second_review_submitted",
  "audit_requested",
  "request_failed",
  "audit_reassigned",
  "reassign_failed",
  "followup_closed",
  "followup_noted",
  "followup_failed",
  "tier1_extended",
  "tier1_failed",
] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);
export const isFailureNotice = (n: Notice): boolean => n.endsWith("failed") || n === "audit_incomplete";

export type DueLabel = "overdue" | "unassigned" | "open" | "done" | "second";

/** What the queue shows for an audit. A critical miss waiting for its second reader is not done, whatever the first score said. */
export function dueLabel(row: Pick<AuditRow, "state" | "overdue"> & { second_review_required?: boolean | null; final?: boolean | null }): DueLabel {
  if ((row.state === "submitted" || row.state === "closed") && row.second_review_required && !row.final) return row.overdue ? "overdue" : "second";
  if (row.state === "submitted" || row.state === "closed") return "done";
  if (row.overdue) return "overdue";
  return row.state === "unassigned" ? "unassigned" : "open";
}

/** True when the signed-in reviewer is the one who has to act on this audit now (first score or second review). */
export function awaitingMe(row: Pick<AuditRow, "state" | "reviewer_id" | "second_reviewer_id" | "second_review_required" | "final">, me: string | null): boolean {
  if (!me) return false;
  if (row.state === "assigned") return row.reviewer_id === me;
  if (row.state === "unassigned") return true;
  return row.state === "submitted" && !!row.second_review_required && !row.final && row.second_reviewer_id === me;
}

/** Reviewer candidates for a reassignment: active chief medical officers other than the audited clinician. */
export function reviewerCandidates(staff: StaffOption[], clinicianProfileId: string): StaffOption[] {
  return staff.filter((s) => s.doctor_tier === "chief_medical_officer" && s.profile_id !== null && s.profile_id !== clinicianProfileId);
}
