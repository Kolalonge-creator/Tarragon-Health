/**
 * Low-carbohydrate type 2 diabetes programme (S50b part 2, spec 6.10, founder decision S50-2).
 *
 * PURE and deterministic (INV-01): no language model, no clock read, no I/O. Every clinical number lives in the versioned PROPOSED config
 * (`lowcarb_protocol_config`, registry key `lowcarb.protocol_rules`) and in the draft diabetes step table (`protocols` code
 * `t2d_lowcarb_deprescribing`). Nothing here is a hard-coded threshold, and every number in those two is a placeholder for the CMO.
 *
 * Three jobs:
 *   1. eligibility (`lowCarbEligibility`): the executable specification of the database twin `private.lowcarb_eligibility_for`.
 *   2. safety (`classifyLowCarbReading`, `lowCarbStopCheck`, `lowCarbCheckins`): when the programme pauses, stops or is behind.
 *   3. medicine review (`proposeLowCarbMedicineReview`): the platform only PROPOSES. A clinician signs (INV-02); nothing here changes a
 *      medicine, a dose or a time, and nothing here is ever shown to the patient as advice.
 *
 * Every doubt resolves in the safe direction: no config, an unparseable answer, an unknown age or pregnancy status all refuse.
 */

export interface LowCarbMatch {
  readonly name_patterns: readonly string[];
  readonly icd10_prefixes: readonly string[];
}

export interface LowCarbMedicineGroup {
  readonly name_patterns: readonly string[];
  /** supervision: a doctor must accept supervision first. exclude: the programme is not offered. */
  readonly handling: "supervision" | "exclude";
}

export interface LowCarbCheckinRule {
  readonly per_week: number;
  readonly max_gap_days: number;
}

export interface LowCarbConfig {
  readonly eligibility: {
    readonly min_age_years: number;
    readonly postnatal_months: number;
    readonly require_confirmed_type_2: boolean;
    readonly severe_hypo_below_mmol: number;
    readonly hypo_lookback_days: number;
    readonly triage_lookback_hours: number;
    readonly condition_exclusions: Readonly<Record<string, LowCarbMatch>>;
    readonly medicine_groups: Readonly<Record<string, LowCarbMedicineGroup>>;
  };
  readonly check_ins: {
    readonly glucose: LowCarbCheckinRule;
    readonly ketones: LowCarbCheckinRule;
    readonly weight: LowCarbCheckinRule;
  };
  readonly safety: {
    readonly pause_glucose_below_mmol: number;
    readonly pause_ketones_at_or_above_mmol: number;
    readonly stop_after_pauses_in_30_days: number;
    readonly stop_if_checkins_missed_days: number;
  };
  readonly medicine_review: {
    readonly window_days: number;
    readonly min_readings: number;
    readonly avg_glucose_below_mmol: number;
    readonly any_glucose_below_mmol: number;
    readonly standing_review_days: number;
  };
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const INACTIVE_STATUSES: readonly string[] = ["resolved", "historical"];

export const LOWCARB_REPRODUCTIVE_REASONS: readonly string[] = ["pregnancy_or_postnatal", "pregnancy_unknown"];

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Eligibility
// ---------------------------------------------------------------------------------------------------------------------------------

export type LowCarbEligibilityDecision = "eligible" | "needs_supervision" | "not_eligible" | "not_now" | "unavailable";

export interface LowCarbConditionRecord {
  readonly name: string;
  readonly icd10: string | null;
  readonly status: string;
}

export interface LowCarbEligibilityInput {
  readonly now: string;
  readonly ageYears: number | null;
  readonly diabetesType: { readonly confirmed: string | null; readonly reported: string | null };
  /** yes covers pregnancy and the postnatal year. unknown (an unreadable record) refuses. */
  readonly pregnancy: "yes" | "no" | "unknown";
  readonly eatingDisorderScreenPositive: boolean;
  readonly conditions: readonly LowCarbConditionRecord[];
  /** Names of the patient's active medicines. */
  readonly medicines: readonly string[];
  readonly glucoseReadings: readonly { readonly mmol: number; readonly at: string }[];
  readonly triageEvents: readonly { readonly grade: "green" | "amber" | "red"; readonly at: string }[];
  readonly confirmations: { readonly noRecentAdmission: boolean; readonly supervisionAccepted: boolean };
}

export interface LowCarbEligibilityResult {
  readonly decision: LowCarbEligibilityDecision;
  readonly reasons: readonly string[];
  /** The medicine groups that need a doctor to accept supervision. */
  readonly supervisionFor: readonly string[];
}

const UNAVAILABLE: LowCarbEligibilityResult = { decision: "unavailable", reasons: ["rules_unavailable"], supervisionFor: [] };

export function lowCarbConditionMatches(records: readonly LowCarbConditionRecord[], match: LowCarbMatch): boolean {
  return records.some((r) => {
    if (INACTIVE_STATUSES.includes(r.status)) return false;
    const name = r.name.toLowerCase();
    const code = (r.icd10 ?? "").toUpperCase();
    return (
      match.name_patterns.some((p) => p !== "" && name.includes(p.toLowerCase())) ||
      (code !== "" && match.icd10_prefixes.some((p) => code.startsWith(p.toUpperCase())))
    );
  });
}

export function lowCarbMedicineMatches(medicines: readonly string[], patterns: readonly string[]): boolean {
  return medicines.some((m) => patterns.some((p) => p !== "" && m.toLowerCase().includes(p.toLowerCase())));
}

export function lowCarbEligibility(input: LowCarbEligibilityInput, config: LowCarbConfig | null): LowCarbEligibilityResult {
  if (config === null) return UNAVAILABLE;
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(nowMs)) return UNAVAILABLE;
  const el = config.eligibility;
  const hard: string[] = [];

  if (input.ageYears === null) hard.push("age_unknown");
  else if (input.ageYears < el.min_age_years) hard.push("under_age");

  const { confirmed, reported } = input.diabetesType;
  if (confirmed !== null) {
    if (confirmed !== "type_2") hard.push("not_type_2");
  } else if (el.require_confirmed_type_2) {
    hard.push("type_unconfirmed");
  } else if (reported !== null && reported !== "type_2") {
    hard.push("not_type_2");
  }

  if (input.pregnancy === "yes") hard.push("pregnancy_or_postnatal");
  else if (input.pregnancy === "unknown") hard.push("pregnancy_unknown");

  if (input.eatingDisorderScreenPositive) hard.push("eating_disorder_screen");

  for (const [key, match] of Object.entries(el.condition_exclusions)) {
    if (lowCarbConditionMatches(input.conditions, match)) hard.push(`condition_${key}`);
  }

  const supervision: string[] = [];
  for (const [key, group] of Object.entries(el.medicine_groups)) {
    if (!lowCarbMedicineMatches(input.medicines, group.name_patterns)) continue;
    if (group.handling === "exclude") hard.push(`medicine_${key}`);
    else supervision.push(key);
  }

  const hypoSince = nowMs - el.hypo_lookback_days * DAY_MS;
  if (input.glucoseReadings.some((g) => g.mmol < el.severe_hypo_below_mmol && Date.parse(g.at) >= hypoSince && Date.parse(g.at) <= nowMs)) {
    hard.push("recent_severe_low_sugar");
  }
  if (!input.confirmations.noRecentAdmission) hard.push("admission_not_ruled_out");

  if (hard.length > 0) return { decision: "not_eligible", reasons: hard, supervisionFor: supervision };

  const triageSince = nowMs - el.triage_lookback_hours * HOUR_MS;
  const recentTriage = input.triageEvents.some((e) => e.grade !== "green" && Date.parse(e.at) >= triageSince && Date.parse(e.at) <= nowMs);
  if (recentTriage) return { decision: "not_now", reasons: ["recent_triage_event"], supervisionFor: supervision };

  if (supervision.length > 0 && !input.confirmations.supervisionAccepted) {
    return { decision: "needs_supervision", reasons: supervision.map((s) => `supervision_${s}`), supervisionFor: supervision };
  }
  return { decision: "eligible", reasons: ["none"], supervisionFor: supervision };
}

/** What a clinician who is NOT entitled to reproductive health data (category-scoped path) is shown instead of a pregnancy reason. */
export function coarsenLowCarbReasons(reasons: readonly string[], mayReadReproductive: boolean): string[] {
  const out: string[] = [];
  for (const r of reasons) {
    const mapped = !mayReadReproductive && LOWCARB_REPRODUCTIVE_REASONS.includes(r) ? "health_condition" : r;
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export type LowCarbPatientGate = { readonly state: "ok" | "unavailable" };

/** Reads `public.my_lowcarb_gate()`. Anything that is not exactly `ok` is `unavailable`: "withheld" and "not live yet" are one answer. */
export function parseLowCarbGate(json: unknown): LowCarbPatientGate {
  if (typeof json !== "object" || json === null) return { state: "unavailable" };
  return (json as Record<string, unknown>).state === "ok" ? { state: "ok" } : { state: "unavailable" };
}

export function unavailableLowCarbGate(): LowCarbPatientGate {
  return { state: "unavailable" };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Safety: pause, stop, check-ins
// ---------------------------------------------------------------------------------------------------------------------------------

export type LowCarbReadingAction = "pause" | "review" | "none";
export interface LowCarbReadingClass {
  readonly action: LowCarbReadingAction;
  readonly code: "low_glucose" | "high_ketones" | "low_normal_glucose" | "none";
}

export function classifyLowCarbReading(reading: { readonly metric: "glucose" | "ketones" | "weight"; readonly value: number }, config: LowCarbConfig): LowCarbReadingClass {
  if (reading.metric === "glucose") {
    if (reading.value < config.safety.pause_glucose_below_mmol) return { action: "pause", code: "low_glucose" };
    if (reading.value < config.medicine_review.any_glucose_below_mmol) return { action: "review", code: "low_normal_glucose" };
  } else if (reading.metric === "ketones" && reading.value >= config.safety.pause_ketones_at_or_above_mmol) {
    return { action: "pause", code: "high_ketones" };
  }
  return { action: "none", code: "none" };
}

export interface LowCarbStopInput {
  readonly now: string;
  readonly pausesLast30Days: number;
  /** The newest glucose, ketone or weight check-in; null when none since enrolment. */
  readonly lastCheckinAt: string | null;
  readonly activeSince: string;
}

export function lowCarbStopCheck(input: LowCarbStopInput, config: LowCarbConfig): { stop: boolean; reason: "repeated_pauses" | "check_ins_lapsed" | null } {
  if (input.pausesLast30Days >= config.safety.stop_after_pauses_in_30_days) return { stop: true, reason: "repeated_pauses" };
  const nowMs = Date.parse(input.now);
  const since = Date.parse(input.lastCheckinAt ?? input.activeSince);
  if (nowMs - since > config.safety.stop_if_checkins_missed_days * DAY_MS) return { stop: true, reason: "check_ins_lapsed" };
  return { stop: false, reason: null };
}

export type LowCarbCheckinStatus = "on_track" | "due" | "overdue";
export interface LowCarbCheckinLine {
  readonly metric: "glucose" | "ketones" | "weight";
  readonly countThisWeek: number;
  readonly expected: number;
  readonly lastAt: string | null;
  readonly status: LowCarbCheckinStatus;
}

export function lowCarbCheckins(
  input: { readonly now: string; readonly readings: readonly { readonly metric: "glucose" | "ketones" | "weight"; readonly at: string }[] },
  config: LowCarbConfig,
): LowCarbCheckinLine[] {
  const nowMs = Date.parse(input.now);
  return (["glucose", "ketones", "weight"] as const).map((metric) => {
    const rule = config.check_ins[metric];
    const mine = input.readings.filter((r) => r.metric === metric && Date.parse(r.at) <= nowMs);
    const countThisWeek = mine.filter((r) => nowMs - Date.parse(r.at) <= 7 * DAY_MS).length;
    const lastMs = mine.reduce((m, r) => Math.max(m, Date.parse(r.at)), Number.NEGATIVE_INFINITY);
    const lastAt = Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : null;
    const overdue = lastAt === null || nowMs - lastMs > rule.max_gap_days * DAY_MS;
    const status: LowCarbCheckinStatus = overdue ? "overdue" : countThisWeek < rule.per_week ? "due" : "on_track";
    return { metric, countThisWeek, expected: rule.per_week, lastAt, status };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. Medicine review (proposals only)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface LowCarbStep {
  readonly id: string;
  readonly label?: string;
  readonly match: { readonly name_patterns: readonly string[] };
  readonly when: { readonly avg_glucose_below_mmol?: number; readonly any_glucose_below_mmol?: number };
  /** stop: a care_plan_changes proposal to stop the medicine. review_dose: a note only, the doctor decides the new dose. */
  readonly action: "stop" | "review_dose";
  readonly rationale: string;
}

export interface LowCarbStepTable {
  readonly code: string;
  readonly version: number;
  readonly status: "draft" | "approved" | "retired";
  readonly placeholder?: boolean;
  readonly steps: readonly LowCarbStep[];
}

export type LowCarbReviewStopCode =
  | "protocol_not_approved_for_real_patient"
  | "programme_not_active"
  | "pregnancy_or_unknown"
  | "open_red_triage"
  | "open_amber_triage"
  | "too_few_readings"
  | "no_trigger";

export interface LowCarbMedicine {
  readonly id: string;
  readonly drugName: string;
  readonly dose: string;
  readonly frequency: string;
  readonly clinicianIssued: boolean;
}

export interface LowCarbReviewInput {
  readonly now: string;
  readonly isTest: boolean;
  readonly programmeActive: boolean;
  readonly pregnancy: "yes" | "no" | "unknown";
  readonly openTriage: "none" | "amber" | "red";
  readonly glucose: readonly { readonly mmol: number; readonly at: string }[];
  readonly medicines: readonly LowCarbMedicine[];
  readonly lastMedicineReviewAt: string | null;
}

export interface LowCarbReviewProposal {
  readonly stepId: string;
  readonly action: "stop" | "review_dose";
  readonly medicationId: string;
  readonly drugName: string;
  readonly currentDose: string;
  readonly rationale: string;
  /** True when a care_plan_changes row can be proposed (a clinician-issued medicine and action stop). Otherwise it is a note for the doctor. */
  readonly proposable: boolean;
}

export type LowCarbReviewResult =
  | {
      readonly kind: "review";
      readonly triggers: readonly string[];
      readonly proposals: readonly LowCarbReviewProposal[];
      readonly readingCount: number;
      readonly averageGlucose: number | null;
    }
  | { readonly kind: "no_proposal"; readonly reasons: readonly LowCarbReviewStopCode[] };

export function proposeLowCarbMedicineReview(input: LowCarbReviewInput, table: LowCarbStepTable, config: LowCarbConfig): LowCarbReviewResult {
  const stops: LowCarbReviewStopCode[] = [];
  // A draft step table drives a proposal for a test patient only; a real patient needs the approved table.
  if (!(table.status === "approved" || (table.status === "draft" && input.isTest))) stops.push("protocol_not_approved_for_real_patient");
  if (!input.programmeActive) stops.push("programme_not_active");
  if (input.pregnancy !== "no") stops.push("pregnancy_or_unknown");
  if (input.openTriage === "red") stops.push("open_red_triage");
  if (input.openTriage === "amber") stops.push("open_amber_triage");

  const mr = config.medicine_review;
  const nowMs = Date.parse(input.now);
  const inWindow = input.glucose.filter((g) => nowMs - Date.parse(g.at) <= mr.window_days * DAY_MS && Date.parse(g.at) <= nowMs);
  const average = inWindow.length > 0 ? inWindow.reduce((s, g) => s + g.mmol, 0) / inWindow.length : null;
  const enough = inWindow.length >= mr.min_readings;

  const triggers: string[] = [];
  if (enough && average !== null && average < mr.avg_glucose_below_mmol) triggers.push("average_glucose_low");
  if (inWindow.some((g) => g.mmol < mr.any_glucose_below_mmol)) triggers.push("a_low_reading");
  const standingDue = input.lastMedicineReviewAt === null || nowMs - Date.parse(input.lastMedicineReviewAt) > mr.standing_review_days * DAY_MS;
  if (standingDue) triggers.push("standing_review_due");

  if (stops.length > 0) return { kind: "no_proposal", reasons: stops };
  if (triggers.length === 0) return { kind: "no_proposal", reasons: [enough ? "no_trigger" : "too_few_readings"] };

  const proposals: LowCarbReviewProposal[] = [];
  for (const step of table.steps) {
    const avgLimit = step.when.avg_glucose_below_mmol;
    const anyLimit = step.when.any_glucose_below_mmol;
    const fired =
      (avgLimit !== undefined && enough && average !== null && average < avgLimit) ||
      (anyLimit !== undefined && inWindow.some((g) => g.mmol < anyLimit));
    if (!fired) continue;
    for (const med of input.medicines) {
      if (!lowCarbMedicineMatches([med.drugName], step.match.name_patterns)) continue;
      proposals.push({
        stepId: step.id,
        action: step.action,
        medicationId: med.id,
        drugName: med.drugName,
        currentDose: med.dose,
        rationale: step.rationale,
        proposable: step.action === "stop" && med.clinicianIssued,
      });
    }
  }
  return { kind: "review", triggers, proposals, readingCount: inWindow.length, averageGlucose: average === null ? null : Math.round(average * 10) / 10 };
}

/** Exact arguments of public.propose_care_plan_change for a "stop" proposal from the step table (INV-02: a draft row only; a clinician signs). */
export function lowCarbProposalToChangeArgs(
  proposal: LowCarbReviewProposal,
  patientId: string,
  protocolId: string,
  engineInputs: Record<string, unknown>,
): {
  p_patient: string;
  p_kind: "medication";
  p_proposal: { action: "stop"; medication_id: string };
  p_rationale: string;
  p_proposed_by: "engine";
  p_protocol_id: string;
  p_engine_inputs: Record<string, unknown>;
} {
  return {
    p_patient: patientId,
    p_kind: "medication",
    p_proposal: { action: "stop", medication_id: proposal.medicationId },
    p_rationale: proposal.rationale,
    p_proposed_by: "engine",
    p_protocol_id: protocolId,
    p_engine_inputs: engineInputs,
  };
}
