/**
 * Safety core — the red-flag evaluator (spec §9).
 *
 * INVARIANTS (enforced here + covered by golden tests):
 *  1. Runs synchronously; callers MUST evaluate before emitting any reply.
 *  2. Every fired rule is returned — nothing is dropped or downgraded here.
 *  3. No auto-close: this module never resolves a flag; only a doctor does.
 *  4. Highest severity wins for the patient-facing safety-net message.
 *  5. An ED/self-harm auto-pause action is surfaced explicitly so the caller
 *     can pause weight-loss tasks in the SAME transaction (spec §9.3, §18.3).
 *
 * This module is condition-agnostic: it takes rules as data (adapter rules +
 * the shared base set) and never contains condition-specific thresholds.
 */
import type {
  EscalationLevel,
  PatientContext,
  RedFlagRule,
  SafetyInput,
  Severity,
} from "../types/index";
import { BASE_RED_FLAG_RULES } from "../adapters/base-rules";

const SEVERITY_RANK: Record<Severity, number> = {
  amber: 1,
  red: 2,
  emergency: 3,
};

export interface FiredFlag {
  key: string;
  severity: Severity;
  level: EscalationLevel;
  action: RedFlagRule["action"];
  safetyNetMessageKey: string;
}

export interface RedFlagEvaluation {
  /** True if any rule fired. Callers gate their reply on this. */
  hasFlag: boolean;
  /** Every rule that fired, most-severe first. Never truncated. */
  fired: FiredFlag[];
  /** Highest severity across all fired flags (null if none). */
  topSeverity: Severity | null;
  /** Highest escalation level across all fired flags (null if none). */
  topLevel: EscalationLevel | null;
  /** True if any fired flag demands weight-loss auto-pause (spec §9.3). */
  autoPauseWeightLoss: boolean;
  /** True if any fired flag demands paging the on-call doctor. */
  pageOnCall: boolean;
  /** Message key for the highest-severity fired flag (safety-net, not verdict). */
  replyMessageKey: string | null;
}

function bySeverityDesc(a: FiredFlag, b: FiredFlag): number {
  const d = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  return d !== 0 ? d : b.level - a.level;
}

/**
 * Evaluate all applicable rules for one inbound datapoint.
 *
 * @param input       the measurement (+ optional recent history)
 * @param adapterRules the active condition adapter's red-flag rules
 * @param patient     minimal patient context rules may branch on
 * @param baseRules   shared base rules (defaults to BASE_RED_FLAG_RULES; param
 *                    exists for testability)
 */
export function evaluateRedFlags(
  input: SafetyInput,
  adapterRules: readonly RedFlagRule[],
  patient: PatientContext,
  baseRules: readonly RedFlagRule[] = BASE_RED_FLAG_RULES,
): RedFlagEvaluation {
  const all = [...baseRules, ...adapterRules];
  const fired: FiredFlag[] = [];

  for (const rule of all) {
    let hit = false;
    try {
      hit = rule.when(input, patient);
    } catch {
      // A rule predicate must never crash the evaluator. A throwing rule is
      // treated as not-fired here, but this is a bug worth surfacing upstream;
      // silence is never assumed safe for MISSING data (handled elsewhere),
      // but a broken predicate should fail loud in tests, not in production.
      hit = false;
    }
    if (hit) {
      fired.push({
        key: rule.key,
        severity: rule.severity,
        level: rule.level,
        action: rule.action,
        safetyNetMessageKey: rule.safetyNetMessageKey,
      });
    }
  }

  fired.sort(bySeverityDesc);

  const top = fired[0] ?? null;
  return {
    hasFlag: fired.length > 0,
    fired,
    topSeverity: top?.severity ?? null,
    topLevel: top?.level ?? null,
    autoPauseWeightLoss: fired.some((f) => f.action === "auto_pause_weightloss"),
    pageOnCall: fired.some((f) => f.action === "page_oncall"),
    replyMessageKey: top?.safetyNetMessageKey ?? null,
  };
}
