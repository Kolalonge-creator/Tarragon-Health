/**
 * The on-device red-flag floor (INV-06, spec 12.8).
 *
 * INV-06: emergency guidance works offline. The red-flag screen therefore has to run with no server, no database and no
 * network, from content that ships inside the app and the web bundle. This module is that floor: a pure function over the
 * bundled copy of the SIGNED red-flag rules (the same rules the database holds in `triage_protocols.config`, kept in step by
 * the parity test in `protocols/config-schema.test.ts`, which compares the TS seed to a copy of the database seed).
 *
 * WHAT IT IS NOT. It is not the triage engine and it never lowers anything: it can only add an emergency or urgent result to
 * whatever the engine says (`safe-triage.ts` takes the more urgent of the two). It carries no questionnaire, no outcome
 * wording beyond a message key, and nothing a model produced (INV-01). Content here is a copy of signed rules, not new
 * clinical content: a rule change is a protocol change (CMO), then a new copy here.
 *
 * DEGRADED MODE. When the engine cannot answer, a severity slider the patient set is a weaker signal than the symptom itself,
 * so the degraded screen may ignore `minSeverity` (a strictly more sensitive screen: it fires on a superset of what the signed
 * rule fires on). Whether to do that is the PROPOSED config `symptom.degraded_mode`; nothing here decides it.
 */
import { evaluateCondition, type RedFlagScreenResult, type FiredRedFlag } from "../engine/index";
import { SEED_PATHWAYS } from "../protocols/index";
import { mostUrgentCategory, type RedFlagCondition, type RedFlagRule, type SymptomCapture, type TriageCategory } from "../types/index";

export interface BundledRedFlagRule extends RedFlagRule {
  /** The pathway whose vocabulary the rule is written in (its symptom, trigger and history keys). */
  pathwayKey: string;
}

/** The signed v1 red-flag rules of every bundled pathway, flattened. Frozen: nothing may edit the floor at runtime. */
export const BUNDLED_RED_FLAG_RULES: readonly BundledRedFlagRule[] = Object.freeze(
  SEED_PATHWAYS.flatMap((p) => p.redFlagScreen.map((r) => Object.freeze({ ...r, pathwayKey: p.key }))),
);

export interface BundledScreenOptions {
  /** Ignore `minSeverity` on every rule (degraded mode only). Default false: the rules fire exactly as signed. */
  ignoreSeverityFloors?: boolean;
  /** Override the rules (tests). */
  rules?: readonly BundledRedFlagRule[];
}

function withoutSeverityFloor(condition: RedFlagCondition): RedFlagCondition {
  const { minSeverity: _dropped, ...rest } = condition;
  void _dropped;
  return rest;
}

/**
 * Evaluate the bundled floor. Rules of the capture's own pathway apply; for a pathway the bundle does not know, EVERY bundled
 * rule is tried (more sensitive, never less). A rule that throws counts as not fired but is listed in `brokenRules`, exactly
 * as the engine reports it.
 */
export function evaluateBundledRedFlags(capture: SymptomCapture, options: BundledScreenOptions = {}): RedFlagScreenResult {
  const all = options.rules ?? BUNDLED_RED_FLAG_RULES;
  const own = all.filter((r) => r.pathwayKey === capture.presentingComplaintKey);
  const rules = own.length > 0 ? own : all;
  const fired: FiredRedFlag[] = [];
  const brokenRules: string[] = [];
  for (const rule of rules) {
    const condition = options.ignoreSeverityFloors ? withoutSeverityFloor(rule.rule) : rule.rule;
    let hit = false;
    try {
      hit = evaluateCondition(condition, capture);
    } catch {
      brokenRules.push(rule.key);
    }
    if (hit) fired.push({ key: rule.key, label: rule.label, category: rule.category });
  }
  const topCategory = fired.reduce<TriageCategory | null>((top, f) => (top === null ? f.category : mostUrgentCategory(top, f.category)), null);
  return { hasFlag: fired.length > 0, fired, brokenRules, topCategory };
}
