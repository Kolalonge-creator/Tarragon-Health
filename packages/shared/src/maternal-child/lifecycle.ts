import { getProposedConfig } from "../proposed-config";

/**
 * Life stages (spec 16.11). A stage changes ONLY on a confirmed event (a person or a clinician says it happened), never by inference from a date,
 * a missed period, an age or a weight. The database function record_lifecycle_event is the authority; this mirror decides which buttons to show.
 */
export const LIFECYCLE_STAGES = ["tracking", "trying", "pregnant", "postnatal", "parenting"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LIFECYCLE_KINDS = [
  "start_trying", "stop_trying", "pregnancy_confirmed", "delivery_recorded", "pregnancy_loss_recorded", "postnatal_period_ended", "parenting_ended",
] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

interface LifecycleRules {
  readonly transitions: Readonly<Record<string, { readonly from: readonly string[]; readonly to: string }>>;
  readonly stage_content: Readonly<Record<string, string>>;
  readonly stage_bp_rule_set: Readonly<Record<string, string>>;
  readonly loss_baby_content_hold_days: number;
  readonly max_days_back: number;
}

export function lifecycleRules(): { rules: LifecycleRules; version: number } {
  const c = getProposedConfig("maternal_child.lifecycle.rules");
  return { rules: c.value as unknown as LifecycleRules, version: c.version };
}

/** The confirmed events that can be offered from a stage, in a stable order. */
export function availableLifecycleKinds(stage: LifecycleStage, rules: LifecycleRules = lifecycleRules().rules): LifecycleKind[] {
  return LIFECYCLE_KINDS.filter((k) => rules.transitions[k]?.from.includes(stage));
}

export function nextStage(stage: LifecycleStage, kind: LifecycleKind, rules: LifecycleRules = lifecycleRules().rules): LifecycleStage | null {
  const t = rules.transitions[kind];
  if (!t || !t.from.includes(stage)) return null;
  return t.to as LifecycleStage;
}

/** Baby and pregnancy content is hidden while a hold date is in the future (after a recorded loss). */
export function babyContentHidden(holdUntil: string | null, today: string): boolean {
  return holdUntil !== null && holdUntil >= today;
}
