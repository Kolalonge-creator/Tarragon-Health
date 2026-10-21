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
  | "difficulty_speaking"
  | "back_pain"
  | "epigastric_pain"
  | "confusion"
  | "visual_disturbance"
  | "fainting"
  | "dizziness"
  | "palpitations"
  // S67 (pregnancy danger signs, CMO selection A2 of 2026-10-07, PROPOSED): rule set version 4 only.
  | "convulsion"
  | "loss_of_consciousness"
  | "sudden_face_hand_swelling";

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
  /** True once the patient has answered the symptom question (ticking none counts). A very high reading asks first. */
  readonly symptomsAnswered?: boolean;
}

export interface AdherenceTrigger {
  readonly type: "adherence";
  /** Taken over due doses in the adherence window (`medicine_config.adherence_window_days`, 7 today), 0 to 100; null when no doses were due. */
  readonly percentWindow: number | null;
  /** Deprecated name of `percentWindow` (follow-up OQ-356): still accepted so an older caller keeps working, never written by new code. */
  readonly percent7d?: number | null;
}

/**
 * A symptom report with no blood pressure reading (follow-up OQ-355). Only rule sets that carry a rule for the `symptom` trigger can grade it;
 * every earlier version has none, so such a report grades green (no rule) under them and the live danger-sign path stays the only thing that pages.
 */
export interface SymptomTrigger {
  readonly type: "symptom";
  readonly symptoms: readonly SymptomCode[];
}

export interface SilenceTrigger {
  readonly type: "silence";
  /** Last blood pressure reading, or null when there has never been one. */
  readonly lastReadingAt: string | null;
  /** When the care pack or pathway started; silence is counted from here when there is no reading. */
  readonly sinceAt: string;
}

export type TriageTrigger = ObservationTrigger | AdherenceTrigger | SilenceTrigger | SymptomTrigger;

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
  /** Within 6 weeks after a birth. Optional; absent means false. */
  readonly postpartum?: boolean;
  readonly ageYears: number | null;
  /**
   * Taking blood pressure medicines now (S07x, decision C5). Optional; ABSENT MEANS UNKNOWN, which is treated as taking them, so a phone that cannot tell still shows the
   * amber guidance for a low reading (as version 3 does). Version 4 of the rule set flags a systolic under 90 with no symptom unless this is explicitly false.
   * The server always sends a definite true or false from the medicines on record.
   */
  readonly onBpMedicines?: boolean;
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
  | { readonly kind: "ask_symptoms"; readonly code: string }
  | { readonly kind: "route_referral"; readonly reason: string }
  | {
      readonly kind: "create_task";
      readonly task: string;
      readonly dueMinutes: number;
      /** Neutral message key for the notification about this task (INV-07). */
      readonly notifyKey: string;
    };

/** Which personal setting moved the grade (threshold overrides). */
export type OverrideParameter = "target" | "lowAmberSystolic" | "hypoAlertMmol" | "hypoSevereMmol";

/**
 * Provenance of a grade that a clinician-signed personal threshold changed. Present on a result ONLY when the override really
 * changed the grade; it carries no reading or target value (INV-07), only which override, which setting and what the grade was
 * without it. The server stores it next to the triage event.
 */
export interface AppliedOverride {
  readonly overrideId: string;
  readonly domain: "bp" | "glucose";
  /** `relaxed` = a less urgent grade than the signed rule set gives; `tightened` = a more urgent one. */
  readonly direction: "relaxed" | "tightened";
  readonly parameters: readonly OverrideParameter[];
  readonly defaultGrade: Grade;
  readonly defaultRuleId: string | null;
  readonly finalGrade: Grade;
  readonly finalRuleId: string | null;
}

export type RejectReason = "implausible_reading" | "invalid_input" | "invalid_rule_set";

export interface TriageResult {
  readonly status: "graded" | "recheck_required" | "symptom_check_required" | "rejected";
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
  /** Set only when a signed personal threshold override changed the grade. */
  readonly override?: AppliedOverride;
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
  readonly triggers: readonly (TriageTrigger["type"] | "glucose")[];
  /** `grade` rules grade; a `recheck` rule only asks for a repeat reading. */
  /** `grade` rules grade; `recheck` asks for a repeat reading; `ask` asks the symptom question. The last two never grade. */
  readonly result: "grade" | "recheck" | "ask";
  /** Which recheck timing a `recheck` rule uses; default `standard`. */
  readonly recheckTiming?: "standard" | "extreme";
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
    readonly extreme: { readonly systolic: number; readonly diastolic: number };
    readonly extremeRecheck: { readonly afterMinutes: number; readonly windowMinutes: number };
    readonly averageWindowDays: number;
    readonly minAdultAgeYears: number;
    readonly silence: { readonly days: number };
    readonly postpartum: { readonly reviewSystolic: number; readonly reviewDiastolic: number; readonly windowDays: number };
    readonly recheckBackupPush: { readonly minAfterMinutes: number; readonly delayMinutes: number };
    readonly pregnancy: { readonly severeSystolic: number; readonly severeDiastolic: number; readonly raisedSystolic: number; readonly raisedDiastolic: number };
    readonly adherence: { readonly minPercent: number };
    readonly symptomGroups: { readonly [group: string]: readonly string[]; readonly redFlag: readonly string[] };
    readonly rejected: { readonly explanationKey: string; readonly redFlagGuidanceCode: string };
    readonly [extra: string]: unknown;
  };
  readonly rules: readonly Rule[];
}
