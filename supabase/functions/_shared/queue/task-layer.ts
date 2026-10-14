// S16-S20 task layer: the pure rules behind the offer window, escalation alerts, coded outcomes, cooling-off and the watchdog.
//
// Pure: no clock of its own (callers pass `now`), no database. The database is the enforcer
// (migration *_s16_s20_task_layer.sql); this is the same arithmetic for tests and for screens that have to show an answer
// before they ask. Every number comes from the versioned `queue.task_layer` configuration (PROPOSED, CMO), never from a literal
// here, and a test fails if the migration seed and the registry value drift.

import type { CooldownRule, RecentHandback } from "./claims.ts";

export interface TaskLayerRules {
  lead_window_cap_fraction: number;
  escalated_non_red_any_eligible: boolean;
  handback_also_excludes_task_for: readonly string[];
  escalation_alert: {
    immediate_max_class: number;
    immediate_channels: readonly string[];
    notice_channels: readonly string[];
    digest_channels: readonly string[];
  };
  completion: CompletionRules;
  watchdog: {
    job_max_age_minutes: Readonly<Record<string, number>>;
    class_warning_minutes: Readonly<Record<string, number>>;
  };
}

export interface CompletionRules {
  default_codes: readonly string[];
  codes_by_type: Readonly<Record<string, readonly string[]>>;
  legacy_kind_types: readonly string[];
  contact_attempts: { min_attempts: number; methods: readonly string[] };
  note_max_chars: number;
}

/**
 * The offer window: the task type's window, or a fraction of the time the task has, whichever is shorter, in whole minutes.
 * Under a minute is no window (the task goes straight to the pool). Red (class 1) never reaches here: it has no window (INV-05).
 */
export function offerWindowMinutes(typeWindowMinutes: number, dueInMinutes: number, fraction: number): number {
  const cap = Math.floor(Math.min(typeWindowMinutes, fraction * dueInMinutes));
  return cap >= 1 ? cap : 0;
}

/** A repeat trigger that tightens the due time tightens an offer still running, by the same share of the task's own life. */
export function windowEndAfterMerge(createdAt: number, newDueAt: number, currentWindowEnd: number, fraction: number): number {
  return Math.min(currentWindowEnd, createdAt + (newDueAt - createdAt) * fraction);
}

export type EscalationTier = "immediate" | "notice";

/** Classes up to the configured limit alert the clinical lead at once; the rest are an in-app notice plus the daily digest. */
export function escalationTier(priorityClass: number, originalClass: number, immediateMaxClass: number): EscalationTier {
  return Math.min(priorityClass, originalClass) <= immediateMaxClass ? "immediate" : "notice";
}

/** The channels an escalation uses. SMS and WhatsApp are never among them (founder decisions F-02 and OQ-05). */
export function escalationChannels(tier: EscalationTier, rules: TaskLayerRules["escalation_alert"]): readonly string[] {
  return tier === "immediate" ? rules.immediate_channels : rules.notice_channels;
}

/** Whether an escalated task may be offered to a clinician without the on_call competency: any non-red task, if the rule is on. */
export function escalatedClaimableWithoutOnCall(priorityClass: number, originalClass: number, anyEligible: boolean): boolean {
  return anyEligible && priorityClass > 1 && originalClass > 1;
}

/** The outcome codes a task type may close with. A type with no entry of its own uses the default list. */
export function allowedOutcomeCodes(type: string, rules: CompletionRules): readonly string[] {
  return rules.codes_by_type[type] ?? rules.default_codes;
}

/** The code an outcome carries: its own `code`, or (two older flows only) its `kind`. */
export function outcomeCode(type: string, outcome: Readonly<Record<string, unknown>>, rules: CompletionRules): string | null {
  const own = typeof outcome["code"] === "string" ? outcome["code"].trim() : "";
  if (own !== "") return own;
  if (!rules.legacy_kind_types.includes(type)) return null;
  const kind = typeof outcome["kind"] === "string" ? outcome["kind"].trim() : "";
  return kind === "" ? null : kind;
}

export type OutcomeShapeError = "queue_outcome_code" | "queue_outcome_note" | "queue_outcome_attempts";

export interface ContactAttempt {
  at: string;
  method: string;
  reached: boolean;
}

/**
 * The part of the outcome check that needs no database: a listed code, a note within its length, and (for a documented contact
 * sequence) enough dated attempts by a permitted method. The checks against the record (a released result, a signed change, an
 * acknowledged page) are the database's alone.
 */
export function checkOutcomeShape(
  type: string,
  outcome: Readonly<Record<string, unknown>>,
  rules: CompletionRules,
  taskCreatedAt: number,
  now: number,
): OutcomeShapeError | null {
  const code = outcomeCode(type, outcome, rules);
  if (code === null || !allowedOutcomeCodes(type, rules).includes(code)) return "queue_outcome_code";
  const note = outcome["note"];
  if ("note" in outcome && (typeof note !== "string" || note.length > rules.note_max_chars)) return "queue_outcome_note";
  if (type === "critical_result_review" && code === "contact_attempts_documented") {
    const attempts = outcome["attempts"];
    if (!Array.isArray(attempts)) return "queue_outcome_attempts";
    const valid = attempts.filter((a) => isValidAttempt(a, rules, taskCreatedAt, now)).length;
    if (valid < rules.contact_attempts.min_attempts || valid !== attempts.length) return "queue_outcome_attempts";
    // three copies of one attempt are one attempt
    const distinct = new Set(attempts.map((a: ContactAttempt) => `${a.at}|${a.method}`)).size;
    if (distinct < rules.contact_attempts.min_attempts) return "queue_outcome_attempts";
  }
  return null;
}

const FIVE_MINUTES_MS = 5 * 60_000;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

function isValidAttempt(a: unknown, rules: CompletionRules, taskCreatedAt: number, now: number): boolean {
  if (typeof a !== "object" || a === null) return false;
  const attempt = a as Partial<ContactAttempt>;
  // an ISO date-time only: a bare keyword or date is not a time an attempt was made
  const at = typeof attempt.at === "string" && ISO_DATE_TIME.test(attempt.at) ? Date.parse(attempt.at) : Number.NaN;
  return (
    !Number.isNaN(at) &&
    at >= taskCreatedAt &&
    at <= now + FIVE_MINUTES_MS &&
    typeof attempt.method === "string" &&
    rules.contact_attempts.methods.includes(attempt.method) &&
    typeof attempt.reached === "boolean"
  );
}

/**
 * When the cooling-off ends: the later of the soft and hard limits that are currently tripped, or null when not cooling off.
 * The n-th most recent counted hand-back is the one whose ageing out brings the count back under the limit.
 */
export function coolingOffUntil(recent: readonly RecentHandback[], now: number, rule: CooldownRule): number | null {
  const soft = endOfLimit(recent.filter((h) => !rule.exemptReasons.includes(h.reason)), now, rule.windowMinutes, rule.count);
  const hard = endOfLimit(recent, now, rule.hardWindowMinutes, rule.hardCount);
  if (soft === null) return hard;
  return hard === null ? soft : Math.max(soft, hard);
}

function endOfLimit(handbacks: readonly RecentHandback[], now: number, windowMinutes: number, limit: number): number | null {
  const windowMs = windowMinutes * 60_000;
  const inWindow = handbacks.filter((h) => h.at > now - windowMs).sort((a, b) => b.at - a.at);
  const nth = inWindow[limit - 1];
  return nth === undefined ? null : nth.at + windowMs;
}

export interface ClassBreach {
  priorityClass: number;
  oldestOpenMinutes: number;
  warnAfterMinutes: number;
}

/** Classes whose oldest open task has waited longer than the class's warning threshold. A class with no threshold is never flagged. */
export function classBreaches(oldestOpenMinutesByClass: Readonly<Record<string, number>>, warnMinutesByClass: Readonly<Record<string, number>>): ClassBreach[] {
  const out: ClassBreach[] = [];
  for (const [cls, minutes] of Object.entries(oldestOpenMinutesByClass)) {
    const warn = warnMinutesByClass[cls];
    if (warn !== undefined && minutes > warn) out.push({ priorityClass: Number(cls), oldestOpenMinutes: minutes, warnAfterMinutes: warn });
  }
  return out.sort((a, b) => a.priorityClass - b.priorityClass);
}

/** Jobs whose last finished run is older than their allowance. A job that has never run is stale. */
export function staleJobs(lastRunAt: Readonly<Record<string, number | undefined>>, now: number, maxAgeMinutes: Readonly<Record<string, number>>): string[] {
  return Object.entries(maxAgeMinutes)
    .filter(([job, max]) => {
      const last = lastRunAt[job];
      return last === undefined || now - last > max * 60_000;
    })
    .map(([job]) => job)
    .sort();
}
