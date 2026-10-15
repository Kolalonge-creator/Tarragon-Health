import {
  loadBpPathwayConfig,
  loadDiabetesReportingConfig,
  loadWeightConfig,
  type BpPathwayConfig,
  type DiabetesReportingConfig,
  type WeightConfig,
} from "./config";

/**
 * Reporting and screening helpers for the pathways (S61). All are REPORTING ONLY: none triggers a medicine change, none grades urgency,
 * and none is a diagnosis. Every threshold is read from the PROPOSED config (decision pack Q2, Q3, Q4, Q7, Q10).
 */

/* ---------------------------- diabetes reporting (Q7) ---------------------------- */

export interface GlucoseSample { readonly mmol: number }

export interface TimeInRangeReport {
  readonly samples: number;
  readonly inRangePct: number | null;
  readonly belowRangePct: number | null;
  readonly belowLowRangePct: number | null;
  readonly inRangeMeetsTarget: boolean | null;
  readonly belowRangeWithinLimit: boolean | null;
  readonly belowLowRangeWithinLimit: boolean | null;
}

const pct = (n: number, d: number): number => Math.round((n / d) * 1000) / 10;

/** Time in range from CGM samples, taken as equally spaced. Below 1 sample there is nothing to report (null, never zero). */
export function timeInRange(samples: readonly GlucoseSample[], cfg: DiabetesReportingConfig = loadDiabetesReportingConfig().value): TimeInRangeReport {
  const n = samples.length;
  if (n === 0) {
    return { samples: 0, inRangePct: null, belowRangePct: null, belowLowRangePct: null, inRangeMeetsTarget: null, belowRangeWithinLimit: null, belowLowRangeWithinLimit: null };
  }
  const inRange = samples.filter((s) => s.mmol >= cfg.rangeLowMmol && s.mmol <= cfg.rangeHighMmol).length;
  const below = samples.filter((s) => s.mmol < cfg.rangeLowMmol).length;
  const belowLow = samples.filter((s) => s.mmol < cfg.timeBelowLowRangeMmol).length;
  const r = { inRangePct: pct(inRange, n), belowRangePct: pct(below, n), belowLowRangePct: pct(belowLow, n) };
  return {
    samples: n,
    ...r,
    inRangeMeetsTarget: r.inRangePct > cfg.timeInRangeTargetPct,
    belowRangeWithinLimit: r.belowRangePct < cfg.timeBelowRangeMaxPct,
    belowLowRangeWithinLimit: r.belowLowRangePct < cfg.timeBelowLowRangeMaxPct,
  };
}

export type Hba1cReport = { readonly state: "no_value" | "at_or_below_target" | "above_target" | "review_flagged" };

/** HbA1c against the individualised target; 8% or more flags a review. The target is the clinician's per patient, default from config. */
export function reportHba1c(valuePct: number | null, individualTargetPct?: number, cfg: DiabetesReportingConfig = loadDiabetesReportingConfig().value): Hba1cReport {
  if (valuePct === null) return { state: "no_value" };
  if (valuePct >= cfg.hba1cReviewPct) return { state: "review_flagged" };
  return { state: valuePct <= (individualTargetPct ?? cfg.hba1cIndividualisedTargetPct) ? "at_or_below_target" : "above_target" };
}

export type PrediabetesScreen = {
  /** Always a screening label, never a diagnosis. */
  readonly label: "screening_not_in_range" | "screening_prediabetes_range" | "screening_diabetes_range" | "no_value";
  readonly basis: readonly ("fasting" | "hba1c")[];
};

/** Prediabetes screening wrapper: ADA fasting 5.6 to 6.9 and HbA1c 5.7 to 6.4, labelled as screening (Q7). A diabetes-range value is a prompt to see the care team. */
export function screenPrediabetes(v: { fastingMmol: number | null; hba1cPct: number | null }, cfg: DiabetesReportingConfig = loadDiabetesReportingConfig().value): PrediabetesScreen {
  const basis: ("fasting" | "hba1c")[] = [];
  let level = 0;
  if (v.fastingMmol !== null) {
    if (v.fastingMmol >= cfg.diagnosisFastingMmol) { level = Math.max(level, 2); basis.push("fasting"); }
    else if (v.fastingMmol >= cfg.prediabetesFastingMinMmol && v.fastingMmol <= cfg.prediabetesFastingMaxMmol) { level = Math.max(level, 1); basis.push("fasting"); }
  }
  if (v.hba1cPct !== null) {
    if (v.hba1cPct >= cfg.diagnosisHba1cPct) { level = Math.max(level, 2); basis.push("hba1c"); }
    else if (v.hba1cPct >= cfg.prediabetesHba1cMinPct && v.hba1cPct <= cfg.prediabetesHba1cMaxPct) { level = Math.max(level, 1); basis.push("hba1c"); }
  }
  if (v.fastingMmol === null && v.hba1cPct === null) return { label: "no_value", basis: [] };
  return { label: (["screening_not_in_range", "screening_prediabetes_range", "screening_diabetes_range"] as const)[level] as PrediabetesScreen["label"], basis };
}

/* --------------------------------- weight (Q10) --------------------------------- */

export interface WeightFlags {
  readonly bmi: number | null;
  readonly bmiBand: "below_overweight" | "overweight" | "obese" | "unknown";
  readonly waistToHeight: number | null;
  readonly waistToHeightFlag: "not_raised" | "raised" | "high" | "unknown";
}

/** BMI at 25 and 30 and waist-to-height at 0.5 (0.6 high). Informational flags; they never reward or punish body size (S58). */
export function classifyWeight(v: { weightKg: number | null; heightCm: number | null; waistCm?: number | null }, cfg: WeightConfig = loadWeightConfig().value): WeightFlags {
  const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  const bmi = ok(v.weightKg) && ok(v.heightCm) ? Math.round((v.weightKg / (v.heightCm / 100) ** 2) * 10) / 10 : null;
  const wth = ok(v.waistCm) && ok(v.heightCm) ? Math.round((v.waistCm / v.heightCm) * 100) / 100 : null;
  return {
    bmi,
    bmiBand: bmi === null ? "unknown" : bmi >= cfg.bmiObese ? "obese" : bmi >= cfg.bmiOverweight ? "overweight" : "below_overweight",
    waistToHeight: wth,
    waistToHeightFlag: wth === null ? "unknown" : wth >= cfg.waistToHeightHigh ? "high" : wth >= cfg.waistToHeightRaised ? "raised" : "not_raised",
  };
}

/* --------------------------- hypertension pathway (Q2 to Q4) --------------------------- */

/** Q2: the clinician sets the target per patient; this is the default by comorbidity. */
export function bpTargetFor(v: { hasCvd: boolean; hasDiabetes: boolean; hasCkd: boolean }, cfg: BpPathwayConfig = loadBpPathwayConfig().value): { systolic: number; diastolic: number } {
  return v.hasCvd || v.hasDiabetes || v.hasCkd ? { ...cfg.targetWithCvdDiabetesCkd } : { ...cfg.targetStandard };
}

export type SevereBpTier = { readonly tier: "none" | "amber" | "red"; readonly ruleNote: string };

/**
 * Q3: at or above the severe line (180/110 by default) with NO symptom is amber (same-day clinician contact, recheck, take the regular medicine);
 * with ANY symptom from the configured list it is red and pages on call. `symptoms === null` means the question was not answered: that is
 * treated as red, because a very high reading with an unanswered symptom question must never be graded lower than the worst answer.
 */
export function gradeSevereBp(v: { systolic: number; diastolic: number; symptoms: readonly string[] | null }, cfg: BpPathwayConfig = loadBpPathwayConfig().value): SevereBpTier {
  const severe = v.systolic >= cfg.severe.systolic || v.diastolic >= cfg.severe.diastolic;
  if (!severe) return { tier: "none", ruleNote: "below the severe line" };
  if (v.symptoms === null) return { tier: "red", ruleNote: "severe reading, symptom question not answered" };
  return v.symptoms.some((s) => cfg.severeSymptoms.includes(s))
    ? { tier: "red", ruleNote: "severe reading with a warning symptom" }
    : { tier: "amber", ruleNote: "severe reading, no warning symptom" };
}

export interface HomeBpReading { readonly systolic: number; readonly diastolic: number; readonly takenAt: string; readonly session: "morning" | "evening" }

export type HomeBpValidation =
  | { readonly valid: false; readonly reason: "too_few_days" | "no_readings" }
  | { readonly valid: true; readonly meanSystolic: number; readonly meanDiastolic: number; readonly raised: boolean; readonly daysUsed: number; readonly readingsUsed: number };

const lagosDay = (iso: string): string => new Date(Date.parse(iso) + 3_600_000).toISOString().slice(0, 10);

/**
 * Q4: seven days of two readings, morning and evening, discard the first day, mean 135/85 or higher counts as raised. Days after the
 * discarded first one are counted from the earliest reading. Fewer usable days than `days - discardFirstDays` is not valid: the app says
 * "not enough readings yet" rather than averaging a thin week.
 */
export function validateHomeBp(readings: readonly HomeBpReading[], cfg: BpPathwayConfig = loadBpPathwayConfig().value): HomeBpValidation {
  const hv = cfg.homeValidation;
  if (readings.length === 0) return { valid: false, reason: "no_readings" };
  const days = [...new Set(readings.map((r) => lagosDay(r.takenAt)))].sort();
  const first = days.slice(0, hv.discardFirstDays);
  const kept = readings.filter((r) => !first.includes(lagosDay(r.takenAt)));
  const keptDays = new Set(kept.map((r) => lagosDay(r.takenAt)));
  if (keptDays.size < hv.days - hv.discardFirstDays) return { valid: false, reason: "too_few_days" };
  const mean = (xs: number[]): number => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const meanSystolic = mean(kept.map((r) => r.systolic));
  const meanDiastolic = mean(kept.map((r) => r.diastolic));
  return { valid: true, meanSystolic, meanDiastolic, raised: meanSystolic >= hv.meanSystolic || meanDiastolic >= hv.meanDiastolic, daysUsed: keptDays.size, readingsUsed: kept.length };
}
