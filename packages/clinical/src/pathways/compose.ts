import type { PathwayAction } from "./types";

/**
 * Cardiometabolic composition (S61, decision pack Q9 option A): a patient with two or more conditions has EACH condition's own rule set
 * run, and the MOST URGENT result wins. This is never a third rule set. Adding a component can only raise or keep the urgency, never
 * lower it (a property test proves it). Components may come from different engines (the blood pressure engine and the pathway engine),
 * so a component is only the part of a result this function needs.
 */
export interface ComponentResult {
  readonly source: string;
  readonly status: "graded" | "recheck_required" | "symptom_check_required" | "rejected";
  readonly grade: "green" | "amber" | "red" | null;
  readonly ruleId: string | null;
  readonly explanationKey: string | null;
  readonly actions: readonly PathwayAction[] | readonly { readonly kind: string }[];
}

export interface ComposedResult {
  readonly urgency: number;
  readonly grade: "green" | "amber" | "red" | null;
  readonly status: ComponentResult["status"];
  readonly winnerSource: string | null;
  readonly winnerRuleId: string | null;
  readonly explanationKey: string | null;
  /** Actions of EVERY component at the winning urgency, de-duplicated, so a second condition can add a task but never remove a page. */
  readonly actions: readonly { readonly kind: string }[];
  readonly componentSources: readonly string[];
}

/** red 3, amber 2, a pending question or repeat reading 1.5, green 1, nothing graded (rejected, no data) 0. */
export function urgencyOf(r: ComponentResult): number {
  if (r.status === "graded") return r.grade === "red" ? 3 : r.grade === "amber" ? 2 : r.grade === "green" ? 1 : 0;
  if (r.status === "recheck_required" || r.status === "symptom_check_required") return 1.5;
  return 0;
}

export function composeCardiometabolic(components: readonly ComponentResult[]): ComposedResult {
  if (components.length === 0) {
    return { urgency: 0, grade: null, status: "rejected", winnerSource: null, winnerRuleId: null, explanationKey: null, actions: [], componentSources: [] };
  }
  const top = Math.max(...components.map(urgencyOf));
  const winners = components.filter((c) => urgencyOf(c) === top);
  const first = winners[0] as ComponentResult;
  const seen = new Set<string>();
  const actions = winners.flatMap((w) => w.actions as readonly { readonly kind: string }[]).filter((a) => {
    const k = JSON.stringify(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    urgency: top,
    grade: top >= 3 ? "red" : top >= 2 ? "amber" : top >= 1 ? (top === 1.5 ? null : "green") : null,
    status: first.status,
    winnerSource: top === 0 ? null : first.source,
    winnerRuleId: top === 0 ? null : first.ruleId,
    explanationKey: top === 0 ? null : first.explanationKey,
    actions: top === 0 ? [] : actions,
    componentSources: components.map((c) => c.source),
  };
}
