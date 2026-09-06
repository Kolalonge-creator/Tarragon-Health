import type { Enums, Tables } from "@tarragon/shared";
import type { Predicate } from "@/lib/rules/predicate";

/**
 * TS-side shape of the Clinical Rules & Care Protocol Engine (spec §32).
 * Mirrors the DB schema in supabase/migrations/20260829093257+
 * (clinical_rules_engine_*) — the DB is the source of truth for the enums
 * and constraints; these types just give the engine code the same shapes
 * with editor/typecheck support.
 */

export type ClinicalRuleCategory = Enums<"clinical_rule_category">;
export type ClinicalRuleDomain = Enums<"clinical_rule_domain">;
export type ClinicalRuleEventType = Enums<"clinical_rule_event_type">;
export type ClinicalRuleActionType = Enums<"clinical_rule_action_type">;
export type ClinicalRuleStatus = Enums<"clinical_rule_status">;
export type ClinicalRuleExecutionMode = Enums<"clinical_rule_execution_mode">;
export type ClinicalRuleExecutionOutcome = Enums<"clinical_rule_execution_outcome">;
export type ClinicalRuleActionStatus = Enums<"clinical_rule_action_status">;

export type ClinicalRuleRow = Tables<"clinical_rules">;
export type ClinicalRuleEventRow = Tables<"clinical_rule_events">;

/**
 * A single window-based aggregate check — the mechanism behind §32.4's own
 * worked example ("repeated readings exceed configured threshold"). Reads
 * `days` of a patient's history for `metric` and counts rows whose value
 * satisfies `comparator`/`threshold`; the count is written into the
 * evaluation context as `window.count` for the rule's predicate to test.
 *
 * This is the ONE piece of clinical-test logic that cannot be expressed by
 * predicate.ts's flat-context DSL alone (that DSL has no notion of "the
 * last N days" or "how many of the patient's readings"), so it is computed
 * up front by apps/web/src/lib/clinical-rules/window.ts and merged into the
 * context before predicate.ts evaluates `conditions.predicate` — the actual
 * comparison logic still goes through the same safe, fail-closed DSL, never
 * a bespoke code path.
 */
export interface RuleWindowSpec {
  /** Which table/column family to read. Extend deliberately, like event_type. */
  metric: "vital_reading" | "screening_result" | "medication_dose_missed" | "appointment_missed";
  /** For metric = 'vital_reading': which vital_type/column to compare. */
  vital_type?: Enums<"vital_type">;
  /** Which numeric field of that vital to compare (e.g. 'systolic', 'diastolic', 'glucose_mmol_l'). */
  field?: string;
  comparator: "gte" | "lte" | "gt" | "lt" | "eq";
  threshold: number;
  days: number;
  /** How many matching rows within the window satisfy the rule. Compared by the predicate, not here — this just names the count field. */
}

/**
 * The full, structured shape of a clinical_rules.conditions jsonb value.
 * `window` is optional (most non-monitoring rules don't need it); `predicate`
 * defaults to {op:"true"} when omitted, matching predicate.ts's own
 * evaluatePredicate default posture.
 */
export interface RuleConditions {
  window?: RuleWindowSpec;
  predicate?: Predicate;
}

export interface RuleActionDefinition {
  action_type: ClinicalRuleActionType;
  /** Free-form payload interpolated at emission time (e.g. task title, notification template key). */
  payload?: Record<string, unknown>;
  /**
   * §32.8: whether this action is safe for the engine to apply on its own
   * once the rule is active, or must always be surfaced to a clinician
   * first. Defaults to true (oversight required) for every action type
   * except 'notification' with a non-clinical payload — see actions.ts.
   */
  requires_clinician_oversight?: boolean;
}

export interface RuleEscalationConfig {
  owner_tier?: Enums<"doctor_tier">;
  sla_minutes?: number;
}

export interface RuleSuppressionConfig {
  cooldown_hours?: number;
  /** Extra context fields (beyond rule_key + patient) folded into the dedup key. */
  dedup_key_fields?: string[];
  episode_key_fields?: string[];
  max_per_episode?: number;
}

/** Parsed, typed view over a clinical_rules row's jsonb columns. */
export interface ParsedClinicalRule extends Omit<ClinicalRuleRow, "conditions" | "actions" | "escalation" | "suppression" | "population"> {
  population: Predicate;
  conditions: RuleConditions;
  actions: RuleActionDefinition[];
  escalation: RuleEscalationConfig;
  suppression: RuleSuppressionConfig;
}

/** The flat context predicate.ts evaluates population/conditions.predicate against. */
export type EvaluationContext = Record<string, unknown>;

export interface EvaluationResult {
  rule: ParsedClinicalRule;
  outcome: ClinicalRuleExecutionOutcome;
  explanation: string;
  context: EvaluationContext;
  supersededByRuleId?: string;
  suppressedBy?: "cooldown" | "deduplication" | "episode_cap" | "manual";
  /** Required by the DB CHECK whenever outcome = 'error'. */
  errorDetail?: string;
  actions: RuleActionDefinition[];
}
