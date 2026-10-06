// S20: the small calculations behind clinical audits (spec 7.8). Pure: no clock, no database, no hard-coded thresholds.
// Every number comes from the active `quality_config` row (mirrored as `quality.audit` in the proposed-config registry).
// The database is the enforcer (public.submit_clinical_audit, private.consider_task_for_audit); this is the same rules for
// tests and for a screen that wants to show a score before the reviewer submits. A shared table of cases
// (packages/queue/fixtures/audit-scoring-cases.json) runs through this file in Jest and through the SQL in the proof.

export type AuditOutcome = "satisfactory" | "minor_concerns" | "significant_concerns" | "unsafe";
export type AuditReason = "red_event" | "titration" | "first_tasks" | "random_sample";

export interface AuditForm {
  safety_items: readonly string[];
  quality_items: readonly string[];
  quality_max: number;
}
export interface AuditOutcomeRules {
  satisfactory_min: number;
  minor_concerns_min: number;
  rationale_min_chars: number;
}
export interface AuditScore {
  totalScore: number;
  criticalMiss: boolean;
  outcome: AuditOutcome;
}
export type AuditScoreError =
  | "form_items_mismatch"
  | "safety_item_not_boolean"
  | "quality_item_out_of_range"
  | "rationale_too_short";

/** A form is complete when it has exactly the form's items: nothing missing, nothing extra. */
function sameKeys(have: readonly string[], want: readonly string[]): boolean {
  return have.length === want.length && [...have].sort().join("\u0000") === [...want].sort().join("\u0000");
}

/**
 * Score a submitted audit. A failed safety item is a critical miss and makes the outcome `unsafe` whatever the quality
 * score; otherwise the outcome follows the score. Anything but `satisfactory` needs a written reason.
 */
export function scoreAudit(
  form: AuditForm,
  rules: AuditOutcomeRules,
  safety: Readonly<Record<string, unknown>>,
  quality: Readonly<Record<string, unknown>>,
  rationale: string | null,
): { ok: true; score: AuditScore } | { ok: false; error: AuditScoreError } {
  if (!sameKeys(Object.keys(safety), form.safety_items) || !sameKeys(Object.keys(quality), form.quality_items)) {
    return { ok: false, error: "form_items_mismatch" };
  }
  let criticalMiss = false;
  for (const value of Object.values(safety)) {
    if (typeof value !== "boolean") return { ok: false, error: "safety_item_not_boolean" };
    if (!value) criticalMiss = true;
  }
  let sum = 0;
  for (const value of Object.values(quality)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > form.quality_max) {
      return { ok: false, error: "quality_item_out_of_range" };
    }
    sum += value;
  }
  const totalScore = Math.round((1000 * sum) / (form.quality_max * form.quality_items.length)) / 10;
  const outcome: AuditOutcome = criticalMiss
    ? "unsafe"
    : totalScore >= rules.satisfactory_min
      ? "satisfactory"
      : totalScore >= rules.minor_concerns_min
        ? "minor_concerns"
        : "significant_concerns";
  if (outcome !== "satisfactory" && (rationale ?? "").trim().length < rules.rationale_min_chars) {
    return { ok: false, error: "rationale_too_short" };
  }
  return { ok: true, score: { totalScore, criticalMiss, outcome } };
}

export interface AuditSamplingFacts {
  priorityClassOriginal: number;
  taskType: string;
  level: 1 | 2;
  tier1Audited: number;
  tier1Target: number;
  /** A stable draw in [0, 100) for this task and month. */
  draw: number;
}

/** Why a completed task is audited, or null when it is not. Red events and titrations are always audited. */
export function auditReason(facts: AuditSamplingFacts, randomRatePercent: number): AuditReason | null {
  if (facts.priorityClassOriginal === 1 || facts.taskType === "red_event_unacknowledged") return "red_event";
  if (facts.taskType === "titration_signoff") return "titration";
  if (facts.level === 1 && facts.tier1Audited < facts.tier1Target) return "first_tasks";
  return facts.draw < randomRatePercent ? "random_sample" : null;
}

export interface Tier1Facts {
  level: 1 | 2;
  submittedAudits: number;
  target: number;
  averageScore: number;
  criticalMisses: number;
}
export interface Tier1Rules {
  graduation_min_score: number;
  max_critical_misses: number;
}

/**
 * Whether the clinical lead should be told that a level 1 clinician has met the audited count. It only ever informs a
 * person; the level itself is changed by the lead (S15 set_clinician_level), never by this.
 */
export function tier1ReadyForReview(facts: Tier1Facts, rules: Tier1Rules): boolean {
  return (
    facts.level === 1 &&
    facts.submittedAudits >= facts.target &&
    facts.averageScore >= rules.graduation_min_score &&
    facts.criticalMisses <= rules.max_critical_misses
  );
}

/** Audit month in Lagos time (UTC+1, no daylight saving): the first day of the month the instant falls in. */
export function lagosAuditMonth(at: Date): string {
  const lagos = new Date(at.getTime() + 60 * 60 * 1000);
  return `${lagos.getUTCFullYear()}-${String(lagos.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
