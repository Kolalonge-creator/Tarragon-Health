import { getProposedConfig, type ConfigValue } from "@tarragon/shared";

/**
 * Typed loaders for the S61/S62 values in the versioned registry. Each loader checks the shape it reads, so a malformed entry fails loudly
 * in a test and never silently on a phone. The version is returned so a caller can record which one it used (INV-16).
 */
export interface Loaded<T> {
  readonly value: T;
  readonly version: number;
  readonly status: "proposed" | "confirmed";
}

function load<T>(key: string, numericKeys: readonly string[], asOf?: string): Loaded<T> {
  const r = getProposedConfig<ConfigValue>(key, asOf);
  const v = r.value;
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${key}: expected an object`);
  const o = v as Record<string, ConfigValue>;
  for (const k of numericKeys) {
    if (typeof o[k] !== "number" || !Number.isFinite(o[k])) throw new Error(`${key}.${k}: expected a number`);
  }
  return { value: v as unknown as T, version: r.version, status: r.status };
}

export interface GlucoseConfig {
  severeHypo: number;
  hypoAlert: number;
  highForDka: number;
  veryHigh: number;
  persistentHigh: number;
  ketoneHigh: number;
  ketoneModerate: number;
  persistentHighMinCount: number;
  recurrentHypoMinCount: number;
  windowDays: number;
  treatCarbGrams: number;
  recheckMinutes: number;
  level2MedReviewCount: number;
  level2MedReviewWindowDays: number;
  insulinOrSulfonylureaDueMinutes: number;
  otherHypoFollowUpDueMinutes: number;
  urgentReviewDueMinutes: number;
  routineReviewDueMinutes: number;
}
const GLUCOSE_KEYS = [
  "severeHypo", "hypoAlert", "highForDka", "veryHigh", "persistentHigh", "ketoneHigh", "ketoneModerate", "persistentHighMinCount",
  "recurrentHypoMinCount", "windowDays", "treatCarbGrams", "recheckMinutes", "level2MedReviewCount", "level2MedReviewWindowDays",
  "insulinOrSulfonylureaDueMinutes", "otherHypoFollowUpDueMinutes", "urgentReviewDueMinutes", "routineReviewDueMinutes",
] as const;
export const loadGlucoseConfig = (asOf?: string): Loaded<GlucoseConfig> => load("diabetes.glucose_thresholds", GLUCOSE_KEYS, asOf);

export interface DiabetesReportingConfig {
  hba1cIndividualisedTargetPct: number;
  hba1cReviewPct: number;
  timeInRangeTargetPct: number;
  rangeLowMmol: number;
  rangeHighMmol: number;
  timeBelowRangeMaxPct: number;
  timeBelowLowRangeMaxPct: number;
  timeBelowLowRangeMmol: number;
  prediabetesFastingMinMmol: number;
  prediabetesFastingMaxMmol: number;
  prediabetesHba1cMinPct: number;
  prediabetesHba1cMaxPct: number;
  diagnosisFastingMmol: number;
  diagnosisTwoHourMmol: number;
  diagnosisHba1cPct: number;
}
export const loadDiabetesReportingConfig = (asOf?: string): Loaded<DiabetesReportingConfig> =>
  load("diabetes.reporting", [
    "hba1cIndividualisedTargetPct", "hba1cReviewPct", "timeInRangeTargetPct", "rangeLowMmol", "rangeHighMmol", "timeBelowRangeMaxPct",
    "timeBelowLowRangeMaxPct", "timeBelowLowRangeMmol", "prediabetesFastingMinMmol", "prediabetesFastingMaxMmol", "prediabetesHba1cMinPct",
    "prediabetesHba1cMaxPct", "diagnosisFastingMmol", "diagnosisTwoHourMmol", "diagnosisHba1cPct",
  ], asOf);

export interface BpPathwayConfig {
  targetStandard: { systolic: number; diastolic: number };
  targetWithCvdDiabetesCkd: { systolic: number; diastolic: number };
  severe: { systolic: number; diastolic: number };
  severeSymptoms: readonly string[];
  amberContactDueMinutes: number;
  homeValidation: {
    days: number;
    readingsPerSession: number;
    minGapMinutes: number;
    sessions: readonly string[];
    discardFirstDays: number;
    meanSystolic: number;
    meanDiastolic: number;
  };
}
export const loadBpPathwayConfig = (asOf?: string): Loaded<BpPathwayConfig> => load("bp.pathway_rules", ["amberContactDueMinutes"], asOf);

export interface WeightConfig { bmiOverweight: number; bmiObese: number; waistToHeightRaised: number; waistToHeightHigh: number }
export const loadWeightConfig = (asOf?: string): Loaded<WeightConfig> =>
  load("pathways.weight", ["bmiOverweight", "bmiObese", "waistToHeightRaised", "waistToHeightHigh"], asOf);

export interface AsthmaCopdConfig {
  relieverUsesPerWeekFlag: number;
  relieversPerYearFlag: number;
  peakFlowRedBelowPctOfBest: number;
  spo2RedBelowPct: number;
  reviewDueMinutes: number;
}
export const loadAsthmaCopdConfig = (asOf?: string): Loaded<AsthmaCopdConfig> =>
  load("pathways.asthma_copd", ["relieverUsesPerWeekFlag", "relieversPerYearFlag", "peakFlowRedBelowPctOfBest", "spo2RedBelowPct", "reviewDueMinutes"], asOf);

export interface HeartFailureConfig { weightGainKg: number; weightGainDays: number; reviewDueMinutes: number }
export const loadHeartFailureConfig = (asOf?: string): Loaded<HeartFailureConfig> =>
  load("pathways.heart_failure", ["weightGainKg", "weightGainDays", "reviewDueMinutes"], asOf);

export interface CkdConfig {
  referEgfrBelow: number;
  referAcrMgPerG: number;
  sustainedFallPct: number;
  sustainedFallMlPerMin: number;
  fallWindowDays: number;
  reviewDueMinutes: number;
}
export const loadCkdConfig = (asOf?: string): Loaded<CkdConfig> =>
  load("pathways.ckd", ["referEgfrBelow", "referAcrMgPerG", "sustainedFallPct", "sustainedFallMlPerMin", "fallWindowDays", "reviewDueMinutes"], asOf);

export interface CadenceConfig {
  automatedReviewDays: number;
  clinicianReviewUncontrolledDays: number;
  clinicianReviewControlledDays: number;
  milestoneDueDays: Record<string, number>;
  scheduledTestIntervalDays: Record<string, number>;
}
export const loadCadenceConfig = (asOf?: string): Loaded<CadenceConfig> =>
  load("pathways.cadence", ["automatedReviewDays", "clinicianReviewUncontrolledDays", "clinicianReviewControlledDays"], asOf);
