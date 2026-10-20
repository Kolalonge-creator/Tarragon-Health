/**
 * workout-recommend gate (S48a, spec 5.1 / 5.2 / 5.5, acceptance: a patient with a red BP event in the last 48 hours sees rest guidance).
 *
 * PURE and deterministic (INV-01): no language model, no clock read, no I/O. Every number lives in the versioned activity safety config
 * (PROPOSED, unsigned; registry key `activity.safety_rules`), so nothing here is a hard-coded threshold.
 *
 * The database function `private.activity_gate_for(uuid)` is the enforcing twin used by the web app, the mobile app and the programme
 * enrolment trigger; this file is its executable specification, and `activity-gate-parity.test.ts` pins the shared case ids to the
 * SQL proof so the two cannot drift silently.
 *
 * Output direction is always the safe one: any doubt (no config, an unreadable rule) restricts, never allows.
 */

export type ActivityIntensity = "gentle" | "moderate" | "vigorous";
export type ActivityGateDecision = "allow" | "restrict" | "rest";

export type ActivityGateReason =
  | "none"
  | "recent_red_event"
  | "recent_amber_event"
  | "pregnancy_high_risk"
  | "pregnancy"
  | "hypertension_unsettled"
  | "arthritis"
  | "back_pain"
  /** What the public door says instead of a pregnancy or a named condition; the pure function never returns it. */
  | "health_condition"
  | "rules_unavailable";

export interface ActivityKindConfig {
  /** Metabolic-equivalent style effort value, for display and weekly load only. Never used to gate. */
  readonly effort_met: number;
  readonly intensity: ActivityIntensity;
}

export interface ActivityRuleConfig {
  readonly max_intensity: ActivityIntensity;
  readonly blocked_kinds: readonly string[];
}

export interface ConditionMatchConfig {
  readonly name_patterns: readonly string[];
  readonly icd10_prefixes: readonly string[];
}

export interface ActivitySafetyConfig {
  readonly lookback: {
    readonly red_hours: number;
    readonly amber_hours: number;
    readonly unsettled_bp_days: number;
  };
  readonly kinds: Readonly<Record<string, ActivityKindConfig>>;
  readonly condition_match: {
    readonly hypertension: ConditionMatchConfig;
    readonly arthritis: ConditionMatchConfig;
    readonly back_pain: ConditionMatchConfig;
  };
  readonly rules: {
    readonly amber: ActivityRuleConfig;
    readonly pregnancy: ActivityRuleConfig;
    readonly pregnancy_high_risk: ActivityRuleConfig;
    readonly hypertension_unsettled: ActivityRuleConfig;
    readonly arthritis: ActivityRuleConfig;
    readonly back_pain: ActivityRuleConfig;
  };
}

export interface ActivityTriageEvent {
  readonly grade: "green" | "amber" | "red";
  /** ISO timestamp. */
  readonly at: string;
  readonly triggerType: string;
}

export interface ActivityConditionRecord {
  readonly name: string;
  readonly icd10: string | null;
  /** condition_clinical_status: active, controlled, uncontrolled, under_investigation, suspected, resolved, historical. */
  readonly status: string;
}

export interface ActivityGateInput {
  /** ISO timestamp the caller supplies, so the function stays pure. */
  readonly now: string;
  readonly events: readonly ActivityTriageEvent[];
  readonly conditions: readonly ActivityConditionRecord[];
  /** Read only through the category-scoped path; null when the reader is not entitled to it or there is no record. */
  readonly pregnancy: { readonly isPregnant: boolean; readonly highRisk: boolean } | null;
}

export interface ActivityGateResult {
  readonly decision: ActivityGateDecision;
  /** The first (highest priority) reason; the full list is in `reasons`. */
  readonly reason: ActivityGateReason;
  readonly reasons: readonly ActivityGateReason[];
  /** "none" means rest: no workout is offered at all. */
  readonly maxIntensity: ActivityIntensity | "none";
  readonly blockedKinds: readonly string[];
}

export const INTENSITY_ORDER: readonly ActivityIntensity[] = ["gentle", "moderate", "vigorous"];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const INACTIVE_STATUSES: readonly string[] = ["resolved", "historical"];

const rank = (i: ActivityIntensity): number => INTENSITY_ORDER.indexOf(i);

export function lowerIntensity(a: ActivityIntensity, b: ActivityIntensity): ActivityIntensity {
  return rank(a) <= rank(b) ? a : b;
}

/** True when a record of a condition family is present and not resolved. Name match is case-insensitive substring; ICD-10 is a prefix match. */
export function conditionPresent(records: readonly ActivityConditionRecord[], match: ConditionMatchConfig): readonly ActivityConditionRecord[] {
  return records.filter((r) => {
    if (INACTIVE_STATUSES.includes(r.status)) return false;
    const name = r.name.toLowerCase();
    const code = (r.icd10 ?? "").toUpperCase();
    return (
      match.name_patterns.some((p) => name.includes(p.toLowerCase())) ||
      (code !== "" && match.icd10_prefixes.some((p) => code.startsWith(p.toUpperCase())))
    );
  });
}

function eventWithin(events: readonly ActivityTriageEvent[], grade: "amber" | "red", windowMs: number, nowMs: number, triggerType?: string): boolean {
  return events.some((e) => {
    if (e.grade !== grade) return false;
    if (triggerType !== undefined && e.triggerType !== triggerType) return false;
    const age = nowMs - Date.parse(e.at);
    return age >= 0 && age <= windowMs;
  });
}

const FAIL_CLOSED: ActivityGateResult = {
  decision: "restrict",
  reason: "rules_unavailable",
  reasons: ["rules_unavailable"],
  maxIntensity: "gentle",
  blockedKinds: [],
};

export function activityGate(input: ActivityGateInput, config: ActivitySafetyConfig | null): ActivityGateResult {
  if (config === null) return FAIL_CLOSED;
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(nowMs)) return FAIL_CLOSED;

  // 1. A red event inside the window is rest, whatever else is true.
  if (eventWithin(input.events, "red", config.lookback.red_hours * HOUR_MS, nowMs)) {
    return { decision: "rest", reason: "recent_red_event", reasons: ["recent_red_event"], maxIntensity: "none", blockedKinds: [] };
  }

  let max: ActivityIntensity = "vigorous";
  const blocked = new Set<string>();
  const reasons: ActivityGateReason[] = [];
  const apply = (reason: ActivityGateReason, rule: ActivityRuleConfig): void => {
    reasons.push(reason);
    max = lowerIntensity(max, rule.max_intensity);
    for (const k of rule.blocked_kinds) blocked.add(k);
  };

  if (eventWithin(input.events, "amber", config.lookback.amber_hours * HOUR_MS, nowMs)) apply("recent_amber_event", config.rules.amber);

  if (input.pregnancy?.isPregnant === true) {
    if (input.pregnancy.highRisk) apply("pregnancy_high_risk", config.rules.pregnancy_high_risk);
    else apply("pregnancy", config.rules.pregnancy);
  }

  const hypertension = conditionPresent(input.conditions, config.condition_match.hypertension);
  if (
    hypertension.length > 0 &&
    (hypertension.some((c) => c.status === "uncontrolled") ||
      eventWithin(input.events, "amber", config.lookback.unsettled_bp_days * DAY_MS, nowMs, "observation") ||
      eventWithin(input.events, "red", config.lookback.unsettled_bp_days * DAY_MS, nowMs, "observation"))
  ) {
    apply("hypertension_unsettled", config.rules.hypertension_unsettled);
  }

  if (conditionPresent(input.conditions, config.condition_match.arthritis).length > 0) apply("arthritis", config.rules.arthritis);
  if (conditionPresent(input.conditions, config.condition_match.back_pain).length > 0) apply("back_pain", config.rules.back_pain);

  if (reasons.length === 0) {
    return { decision: "allow", reason: "none", reasons: ["none"], maxIntensity: "vigorous", blockedKinds: [] };
  }
  return { decision: "restrict", reason: reasons[0] as ActivityGateReason, reasons, maxIntensity: max, blockedKinds: [...blocked].sort() };
}

/** Whether one activity kind may be offered under a gate result. An unknown kind is refused (fail closed). */
export function kindAllowed(result: ActivityGateResult, kind: string, config: ActivitySafetyConfig): boolean {
  if (result.decision === "rest") return false;
  const k = config.kinds[kind];
  if (k === undefined) return false;
  if (result.blockedKinds.includes(kind)) return false;
  return result.maxIntensity !== "none" && rank(k.intensity) <= rank(result.maxIntensity);
}

/** Whether a programme/plan of a given intensity may be offered. */
export function intensityAllowed(result: ActivityGateResult, intensity: ActivityIntensity): boolean {
  return result.maxIntensity !== "none" && rank(intensity) <= rank(result.maxIntensity);
}

/** The i18n key for patient-facing guidance. Wording never names a reading, a condition or a pregnancy. */
export function activityGateMessageKey(result: ActivityGateResult): "activity.gate.rest" | "activity.gate.restrict" | "activity.gate.allow" {
  if (result.decision === "rest") return "activity.gate.rest";
  return result.decision === "restrict" ? "activity.gate.restrict" : "activity.gate.allow";
}

const GATE_DECISIONS: readonly string[] = ["allow", "restrict", "rest"];
const GATE_MAX: readonly string[] = ["none", ...INTENSITY_ORDER];
const GATE_REASONS: readonly string[] = [
  "none", "recent_red_event", "recent_amber_event", "pregnancy_high_risk", "pregnancy", "hypertension_unsettled", "arthritis", "back_pain", "health_condition", "rules_unavailable",
];

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Reads the JSON that `public.activity_gate()` returns. Anything that is not exactly that shape (a missing field, an unknown word, a "rest" that
 * still carries an intensity) fails closed to gentle-only, never to allow: a client that cannot read the answer must not guess a permissive one.
 */
export function parseActivityGate(json: unknown): ActivityGateResult {
  if (typeof json !== "object" || json === null) return FAIL_CLOSED;
  const o = json as Record<string, unknown>;
  const { decision, reason, reasons, max_intensity: max, blocked_kinds: blocked } = o;
  if (typeof decision !== "string" || !GATE_DECISIONS.includes(decision)) return FAIL_CLOSED;
  if (typeof reason !== "string" || !GATE_REASONS.includes(reason)) return FAIL_CLOSED;
  if (!isStringArray(reasons) || !reasons.every((r) => GATE_REASONS.includes(r))) return FAIL_CLOSED;
  if (typeof max !== "string" || !GATE_MAX.includes(max)) return FAIL_CLOSED;
  if (!isStringArray(blocked)) return FAIL_CLOSED;
  if ((decision === "rest") !== (max === "none")) return FAIL_CLOSED;
  return {
    decision: decision as ActivityGateDecision,
    reason: reason as ActivityGateReason,
    reasons: reasons as ActivityGateReason[],
    maxIntensity: max as ActivityIntensity | "none",
    blockedKinds: blocked,
  };
}

/** What a client shows when the gate could not be asked at all (offline, an RPC error): the same fail-closed answer. */
export function unavailableActivityGate(): ActivityGateResult {
  return FAIL_CLOSED;
}
