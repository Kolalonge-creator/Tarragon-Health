/** Entry for `@tarragon/clinical/pathways`: the generic pathway engine, rule sets, reporting helpers and registry. Pure; no Deno imports. */
export { gradePathway, validatePathwayRuleSet } from "./engine";
export { evaluateCondition } from "./evaluate";
export * from "./types";
export * from "./config";
export { DIABETES_CARE_V1, buildDiabetesCareRuleSet, buildGlucoseFacts, GLUCOSE_EVENT_CODES, type GlucoseEventCode, type GlucoseFactsInput, type GlucoseReadingFact } from "./rules/diabetes-care";
export {
  ASTHMA_COPD_V1, CKD_V1, HEART_FAILURE_V1,
  buildAsthmaCopdRuleSet, buildAsthmaFacts, buildCkdFacts, buildCkdRuleSet, buildHeartFailureFacts, buildHeartFailureRuleSet,
  type AsthmaFactsInput, type CkdFactsInput, type WeightPoint,
} from "./rules/release3";
export { composeCardiometabolic, urgencyOf, type ComponentResult, type ComposedResult } from "./compose";
export { classifyWeight, bpTargetFor, gradeSevereBp, reportHba1c, screenPrediabetes, timeInRange, validateHomeBp } from "./reporting";
export type { HomeBpReading, HomeBpValidation, Hba1cReport, PrediabetesScreen, SevereBpTier, TimeInRangeReport, WeightFlags } from "./reporting";
export { PATHWAY_DEFINITIONS, pathwayByCode, type PathwayDefinition, type PathwayKind } from "./registry";
export { PATHWAY_MESSAGE_KEYS, pathwayMessageKeyFor } from "./messages";
export { HTN_RTSL_NG_DRAFT, HTN_STEP_IDS, loadHypertensionStepTable } from "./step-table";
