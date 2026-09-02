import type { ParsedClinicalRule } from "./types";

/**
 * §32.9 conflict resolution: "Suppose two rules produce different actions
 * ... the more specific approved rule may take precedence."
 *
 * Applies to rules that BOTH matched the same event and BOTH would act
 * (population matched, conditions met). Ordering is specificity first,
 * priority second — a signed patient-specific override always beats a
 * platform-general rule regardless of that general rule's priority number,
 * which is what §32.9's "general -> specialist -> patient-specific" ladder
 * actually means: specificity is a category, priority is only a tie-break
 * within it.
 *
 * A conflict here means "targets the same patient with the same
 * action_type" — two rules producing genuinely different kinds of action
 * (one creates a task, another sends a notification) are not in conflict at
 * all and both proceed; §32.9's example is specifically about rules that
 * would otherwise both fire and step on each other.
 */
export function resolveConflicts(
  candidates: ParsedClinicalRule[]
): { winners: ParsedClinicalRule[]; losers: Map<string, ParsedClinicalRule> } {
  // Grouped by each rule's PRIMARY action type (its first configured
  // action). This is a deliberate v1 scope limit: a rule with several
  // differently-typed actions is rare in the seeded catalogue and every
  // seeded rule declares exactly one, so conflict resolution at the
  // whole-rule level (rather than resolving each of a rule's actions
  // independently) is the honest, simple thing to build now rather than a
  // partially-correct per-action version. A rule with no actions at all
  // (population/conditions-only, unusual but not invalid) is put in its own
  // bucket and never conflicts with anything.
  const byActionType = new Map<string, ParsedClinicalRule[]>();

  for (const rule of candidates) {
    const key = rule.actions[0]?.action_type ?? `__none__:${rule.id}`;
    const bucket = byActionType.get(key) ?? [];
    bucket.push(rule);
    byActionType.set(key, bucket);
  }

  const losers = new Map<string, ParsedClinicalRule>();
  const winners: ParsedClinicalRule[] = [];

  for (const bucket of byActionType.values()) {
    const sorted = [...bucket].sort((a, b) => {
      if (a.specificity !== b.specificity) return b.specificity - a.specificity;
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.rule_key.localeCompare(b.rule_key);
    });
    winners.push(sorted[0]);
    for (const loser of sorted.slice(1)) {
      losers.set(loser.id, sorted[0]);
    }
  }

  return { winners, losers };
}
