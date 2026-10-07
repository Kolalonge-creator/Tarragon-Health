/**
 * Generic pathway engine types (S62). The engine is a pure function of (facts, rule set): no clock, no I/O, no randomness and no model
 * (INV-01). A phone, a Next.js server and a test give the same answer for the same input. Every clinical number lives in a rule set's
 * `params`, which is BUILT from the versioned PROPOSED config (packages/shared/src/proposed-config), never typed in an engine file.
 *
 * The result shape is deliberately the same as the blood pressure engine's (supabase/functions/_shared/clinical/types.ts) for the
 * fields `record_triage_result` reads, so the one INV-05 paging path (triage_events -> create_red_page) serves every pathway.
 */
export type PathwayGrade = "green" | "amber" | "red";

export type PathwayFactValue = number | string | boolean | null;
export type PathwayFacts = Readonly<Record<string, PathwayFactValue>>;

export type PathwayAction =
  | { readonly kind: "show_emergency_guidance"; readonly code: string }
  | { readonly kind: "page_on_call" }
  | { readonly kind: "show_message"; readonly code: string }
  | { readonly kind: "route_referral"; readonly reason: string }
  | { readonly kind: "create_task"; readonly task: string; readonly dueMinutes: number; readonly notifyKey: string };

export type CmpOp = "gte" | "gt" | "lte" | "lt" | "eq" | "neq";
export type Operand = number | string | boolean | { readonly ref: string };

export type PathwayCondition =
  | { readonly all: readonly PathwayCondition[] }
  | { readonly any: readonly PathwayCondition[] }
  | { readonly not: PathwayCondition }
  | { readonly field: string; readonly op: CmpOp; readonly value: Operand };

export interface PathwayRule {
  readonly id: string;
  readonly description: string;
  readonly grade: PathwayGrade;
  readonly explanationKey: string;
  readonly when: PathwayCondition;
  readonly actions: readonly PathwayAction[];
  /** Which occurrence the task key is anchored to: this reading, or this ISO week. Required when a rule creates a task. */
  readonly taskAnchor?: "reading" | "week";
}

export interface PathwayRuleSet {
  readonly code: string;
  readonly version: number;
  readonly status: "draft" | "approved" | "retired";
  /** Numeric params are addressable from a rule as `{ ref: "params.severeHypo" }`. */
  readonly params: Readonly<Record<string, number>>;
  readonly rules: readonly PathwayRule[];
}

export interface PathwayInput {
  readonly facts: PathwayFacts;
  /** ISO timestamp of the reading or event being graded. Used only to anchor a task key. */
  readonly readingAt: string;
  /** ISO timestamp. The engine never reads the clock. */
  readonly now: string;
  /** Task keys already open for this patient; a repeat is not created again. */
  readonly existingOpenTaskKeys?: readonly string[];
}

export interface PathwayResult {
  readonly status: "graded" | "rejected";
  readonly grade: PathwayGrade | null;
  readonly ruleId: string | null;
  readonly explanationKey: string | null;
  readonly actions: readonly PathwayAction[];
  readonly matchedRuleIds: readonly string[];
  readonly taskKey: string | null;
  readonly duplicateSuppressed: boolean;
  readonly reason: "invalid_rule_set" | "invalid_input" | null;
  readonly ruleSet: { readonly code: string; readonly version: number };
}
