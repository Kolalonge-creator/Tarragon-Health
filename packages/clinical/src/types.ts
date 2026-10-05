/**
 * Types for the triage engine (spec Section 6.1). Everything here is plain data:
 * the engine takes an input and a rule set and returns a result, with no clock,
 * no I/O and no randomness, so a phone and a server give the same answer (INV-01).
 */
export type Grade = "green" | "amber" | "red";

export type SymptomCode =
  | "severe_headache"
  | "chest_pain"
  | "breathlessness"
  | "weakness_or_numbness"
  | "confusion"
  | "visual_disturbance"
  | "fainting"
  | "dizziness"
  | "palpitations";

export type PathwayState = "self_guided" | "care_pack_active" | "paused" | "discharged" | "referred_out";

export interface Reading {
  readonly systolic: number;
  readonly diastolic: number;
  /** ISO 8601 timestamp. */
  readonly takenAt: string;
}

/**
 * Where a reading sits in the repeat-after-rest flow (BP-A1). `repeat` means the
 * current reading is the second one, taken `minutesSincePrevious` after
 * `previous`. `timed_out` means the patient did not repeat in time, so the
 * current (first) reading is graded as if it had been repeated.
 */
export type RecheckState =
  | { readonly kind: "repeat"; readonly previous: Reading; readonly minutesSincePrevious: number }
  | { readonly kind: "timed_out" };

export interface ObservationTrigger {
  readonly type: "observation";
  readonly reading: Reading;
  readonly symptoms: readonly SymptomCode[];
  readonly recheck?: RecheckState;
}

export interface AdherenceTrigger {
  readonly type: "adherence";
  /** Taken over due doses in the last 7 days, 0 to 100; null when no doses were due. */
  readonly percent7d: number | null;
}

export interface SilenceTrigger {
  readonly type: "silence";
  /** Last blood pressure reading, or null when there has never been one. */
  readonly lastReadingAt: string | null;
  /** When the care pack or pathway started; silence is counted from here when there is no reading. */
  readonly sinceAt: string;
}

export type TriageTrigger = ObservationTrigger | AdherenceTrigger | SilenceTrigger;

export interface BpTarget {
  readonly systolic: number;
  readonly diastolic: number;
}

export interface TriageInput {
  readonly trigger: TriageTrigger;
  /** Earlier readings, last 14 days. The current reading is NOT in this list. */
  readonly history: readonly Reading[];
  readonly target: BpTarget;
  readonly pathway: { readonly state: PathwayState };
  /** Always false in Stage 1; a pregnant user is routed to a clinician. */
  readonly pregnant: boolean;
  readonly ageYears: number | null;
  /** ISO 8601. The engine never reads the clock. */
  readonly now: string;
  /** Task keys that are already open for this patient; a repeat is not created again. */
  readonly existingOpenTaskKeys?: readonly string[];
}

export type TriageAction =
  | { readonly kind: "show_emergency_guidance"; readonly code: string }
  | { readonly kind: "page_on_call" }
  | { readonly kind: "show_message"; readonly code: string }
  | { readonly kind: "prompt_recheck"; readonly code: string }
  | { readonly kind: "route_referral"; readonly reason: string }
  | {
      readonly kind: "create_task";
      readonly task: string;
      readonly dueMinutes: number;
      /** Neutral message key for the notification about this task (INV-07). */
      readonly notifyKey: string;
    };

export type RejectReason = "implausible_reading" | "invalid_input" | "invalid_rule_set";

export interface TriageResult {
  readonly status: "graded" | "recheck_required" | "rejected";
  readonly grade: Grade | null;
  readonly ruleId: string | null;
  /** Clip and text code, for example TRI-001 or EMG-001. */
  readonly explanationKey: string | null;
  readonly actions: readonly TriageAction[];
  readonly matchedRuleIds: readonly string[];
  /** Stable key for the task this result asks for; the database refuses a second task with the same key. */
  readonly taskKey: string | null;
  /** True when the task was already open, so `create_task` was dropped. */
  readonly duplicateSuppressed: boolean;
  readonly recheck: { readonly afterMinutes: number; readonly windowMinutes: number; readonly waitMinutes: number } | null;
  /** Set on a rejected result when a red-flag symptom was ticked: guidance still shows. */
  readonly redFlagSymptomPresent: boolean;
  readonly reason: RejectReason | null;
  readonly ruleSet: { readonly code: string; readonly version: number };
}

export type CmpOp = "gte" | "gt" | "lte" | "lt" | "eq" | "neq";
export type Operand = number | string | boolean | { readonly ref: string; readonly add?: number };

export type Condition =
  | { readonly all: readonly Condition[] }
  | { readonly any: readonly Condition[] }
  | { readonly not: Condition }
  | { readonly field: string; readonly op: CmpOp; readonly value: Operand }
  | { readonly symptomGroup: string };

export type TaskAnchor = "reading" | "week" | "lastReadingDate";

export interface Rule {
  readonly id: string;
  readonly description: string;
  readonly triggers: readonly TriageTrigger["type"][];
  /** `grade` rules grade; a `recheck` rule only asks for a repeat reading. */
  readonly result: "grade" | "recheck";
  readonly grade?: Grade;
  readonly explanationKey: string;
  readonly when: Condition;
  readonly actions: readonly TriageAction[];
  readonly taskAnchor?: TaskAnchor;
}

export interface RuleSet {
  readonly code: string;
  readonly version: number;
  readonly status: "draft" | "approved" | "retired";
  readonly params: {
    readonly validation: {
      readonly systolicMin: number;
      readonly systolicMax: number;
      readonly diastolicMin: number;
      readonly diastolicMax: number;
    };
    readonly recheck: { readonly afterMinutes: number; readonly windowMinutes: number };
    readonly averageWindowDays: number;
    readonly minAdultAgeYears: number;
    readonly silence: { readonly days: number };
    readonly adherence: { readonly minPercent: number };
    readonly symptomGroups: { readonly [group: string]: readonly string[]; readonly redFlag: readonly string[] };
    readonly rejected: { readonly explanationKey: string; readonly redFlagGuidanceCode: string };
    readonly [extra: string]: unknown;
  };
  readonly rules: readonly Rule[];
}
