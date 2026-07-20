/**
 * Cardiovascular-risk stratification engine (lipids treated as ONE input to
 * total CV risk, never the LDL number in isolation).
 *
 * This is a pure, config-driven decision layer. It does NOT invent a
 * continuous risk equation — the 10-year CVD risk % comes from the existing
 * risk score (patient_risk_scores.cvd_10yr). This engine applies the
 * primary-vs-secondary-prevention rules, LDL/Non-HDL targets, statin-
 * eligibility framing, and escalation triggers on top of it. EVERY numeric
 * threshold and target is supplied by the Medical-Director-signed
 * cv_risk_config — nothing clinical is hardcoded here.
 *
 * Two hard product rules encoded structurally:
 *  1. It never prescribes. "Statin near-automatic" for secondary prevention
 *     means an untreated high-risk patient is FLAGGED for clinician review —
 *     the engine only emits recommendations + escalations, never a medication.
 *  2. Primary prevention is a risk-driven, lifestyle-first CLINICIAN
 *     conversation, not an automatic trigger.
 */

export interface CvRiskConfig {
  unit: string;
  population_note: string;
  targets_mg_dl: {
    secondary: { ldl_max: number; non_hdl_max: number };
    primary_high: { ldl_max: number; non_hdl_max: number };
    primary_standard: { ldl_max: number; non_hdl_max: number };
  };
  statin_eligibility: {
    secondary_recommend: boolean;
    diabetes_min_age: number;
    primary_10yr_risk_pct: number;
  };
  escalation_mg_dl: {
    very_high_ldl: number;
    very_high_non_hdl: number;
    worsening_trend_pct: number;
  };
  chronic_lipid_monitoring_months: number;
}

/**
 * Provisional guideline defaults, mirrored from the seeded cv_risk_config row.
 * Used ONLY as a fallback when no signed config is in force, and always
 * surfaced with `configSigned: false` so the UI can label it "awaiting
 * Medical-Director sign-off". The database seed is the real source of truth.
 */
export const PROVISIONAL_CV_RISK_CONFIG: CvRiskConfig = {
  unit: "mg/dL",
  population_note:
    "10-year CVD risk is estimated with SCORE2 (European-derived) and is not validated for Sub-Saharan African populations; treat it as a guide and confirm clinically.",
  targets_mg_dl: {
    secondary: { ldl_max: 70, non_hdl_max: 100 },
    primary_high: { ldl_max: 100, non_hdl_max: 130 },
    primary_standard: { ldl_max: 116, non_hdl_max: 145 },
  },
  statin_eligibility: {
    secondary_recommend: true,
    diabetes_min_age: 40,
    primary_10yr_risk_pct: 10,
  },
  escalation_mg_dl: {
    very_high_ldl: 190,
    very_high_non_hdl: 220,
    worsening_trend_pct: 10,
  },
  chronic_lipid_monitoring_months: 6,
};

export type RiskLevel = "low" | "moderate" | "high" | "very_high";
export type PreventionCategory = "secondary" | "primary";

export type StatinRecommendation =
  | "secondary_prevention_recommended"
  | "primary_risk_based_recommended"
  | "primary_lifestyle_first"
  | "insufficient_data";

export interface CvRiskEscalation {
  code:
    | "untreated_secondary_prevention"
    | "very_high_ldl"
    | "very_high_non_hdl"
    | "worsening_trend_on_treatment"
    | "not_at_target_on_treatment";
  label: string;
  severity: "review" | "urgent";
}

export interface CardiovascularProfile {
  established_ascvd: boolean;
  prior_mi: boolean;
  prior_stroke_tia: boolean;
  prior_pad: boolean;
  prior_revascularisation: boolean;
  familial_hypercholesterolaemia: boolean;
}

export interface CvRiskInputs {
  age: number | null;
  sex: "male" | "female" | null;
  ldlMgDl: number | null;
  nonHdlMgDl: number | null;
  /** Prior Non-HDL, for worsening-trend detection while on treatment. */
  previousNonHdlMgDl: number | null;
  tenYearRiskPct: number | null;
  tenYearRiskLevel: RiskLevel | null;
  /** Active diabetes care plan. */
  diabetes: boolean;
  cvProfile: CardiovascularProfile | null;
  /** Active statin / other lipid-lowering medication. */
  onLipidLoweringTherapy: boolean;
}

export interface CvRiskAssessment {
  preventionCategory: PreventionCategory;
  riskCategory: RiskLevel;
  ldlTargetMgDl: number;
  nonHdlTargetMgDl: number;
  /** null when no lipid value is available to compare. */
  atTarget: boolean | null;
  statinRecommendation: StatinRecommendation;
  escalations: CvRiskEscalation[];
  configSigned: boolean;
  populationNote: string;
  rationale: string[];
}

function hasPriorEvent(p: CardiovascularProfile): boolean {
  return (
    p.established_ascvd ||
    p.prior_mi ||
    p.prior_stroke_tia ||
    p.prior_pad ||
    p.prior_revascularisation
  );
}

/**
 * Stratify a patient's cardiovascular risk and lipid management position.
 * Pure function — all thresholds come from `config`; `configSigned` records
 * whether that config is the Medical-Director-signed one or a provisional
 * fallback, so callers can label the output honestly.
 */
export function assessCvRisk(
  inputs: CvRiskInputs,
  config: CvRiskConfig,
  opts: { configSigned: boolean }
): CvRiskAssessment {
  const rationale: string[] = [];
  const profile = inputs.cvProfile;
  const diabetesIndication =
    inputs.diabetes &&
    (inputs.age === null || inputs.age >= config.statin_eligibility.diabetes_min_age);

  // Per spec, prior CV event / established ASCVD / familial hypercholesterolaemia
  // / diabetes (age-qualified) all place the patient in the secondary /
  // near-automatic bucket.
  const fh = profile?.familial_hypercholesterolaemia ?? false;
  const isSecondary =
    (profile !== null && hasPriorEvent(profile)) || fh || diabetesIndication;

  const preventionCategory: PreventionCategory = isSecondary ? "secondary" : "primary";

  let ldlTargetMgDl: number;
  let nonHdlTargetMgDl: number;
  let riskCategory: RiskLevel;
  let statinRecommendation: StatinRecommendation;

  if (isSecondary) {
    ldlTargetMgDl = config.targets_mg_dl.secondary.ldl_max;
    nonHdlTargetMgDl = config.targets_mg_dl.secondary.non_hdl_max;
    riskCategory = "very_high";
    statinRecommendation = config.statin_eligibility.secondary_recommend
      ? "secondary_prevention_recommended"
      : "insufficient_data";
    if (profile && hasPriorEvent(profile)) {
      rationale.push("Prior cardiovascular event / established ASCVD on record.");
    }
    if (fh) rationale.push("Familial hypercholesterolaemia flagged.");
    if (diabetesIndication) {
      rationale.push(
        `Diabetes with age ≥ ${config.statin_eligibility.diabetes_min_age} — statin indication.`
      );
    }
    rationale.push(
      "High-risk / secondary prevention: statin therapy is near-automatic — surfaced for clinician review, tight LDL/Non-HDL targets applied."
    );
  } else {
    // Primary prevention: risk-driven, lifestyle-first.
    if (inputs.tenYearRiskPct === null) {
      statinRecommendation = "insufficient_data";
      ldlTargetMgDl = config.targets_mg_dl.primary_standard.ldl_max;
      nonHdlTargetMgDl = config.targets_mg_dl.primary_standard.non_hdl_max;
      riskCategory = inputs.tenYearRiskLevel ?? "moderate";
      rationale.push(
        "No 10-year CVD risk estimate yet — record BP, smoking status and a lipid panel to stratify. Lifestyle-first meanwhile."
      );
    } else if (inputs.tenYearRiskPct >= config.statin_eligibility.primary_10yr_risk_pct) {
      statinRecommendation = "primary_risk_based_recommended";
      ldlTargetMgDl = config.targets_mg_dl.primary_high.ldl_max;
      nonHdlTargetMgDl = config.targets_mg_dl.primary_high.non_hdl_max;
      riskCategory = inputs.tenYearRiskLevel ?? "high";
      rationale.push(
        `10-year CVD risk ${inputs.tenYearRiskPct}% ≥ ${config.statin_eligibility.primary_10yr_risk_pct}% threshold — statin is a lifestyle-first clinician conversation, not an automatic trigger.`
      );
    } else {
      statinRecommendation = "primary_lifestyle_first";
      ldlTargetMgDl = config.targets_mg_dl.primary_standard.ldl_max;
      nonHdlTargetMgDl = config.targets_mg_dl.primary_standard.non_hdl_max;
      riskCategory = inputs.tenYearRiskLevel ?? "low";
      rationale.push(
        `10-year CVD risk ${inputs.tenYearRiskPct}% below the ${config.statin_eligibility.primary_10yr_risk_pct}% threshold — lifestyle first, statin not routinely indicated.`
      );
    }
  }

  // At-target evaluation (Non-HDL primary; LDL secondary if present).
  let atTarget: boolean | null = null;
  if (inputs.nonHdlMgDl !== null) {
    atTarget =
      inputs.nonHdlMgDl <= nonHdlTargetMgDl &&
      (inputs.ldlMgDl === null || inputs.ldlMgDl <= ldlTargetMgDl);
  } else if (inputs.ldlMgDl !== null) {
    atTarget = inputs.ldlMgDl <= ldlTargetMgDl;
  }

  const escalations: CvRiskEscalation[] = [];

  if (isSecondary && !inputs.onLipidLoweringTherapy) {
    escalations.push({
      code: "untreated_secondary_prevention",
      label:
        "High-risk / secondary-prevention patient not on lipid-lowering therapy — flag for clinician review.",
      severity: "urgent",
    });
  }
  if (inputs.ldlMgDl !== null && inputs.ldlMgDl >= config.escalation_mg_dl.very_high_ldl) {
    escalations.push({
      code: "very_high_ldl",
      label: `Very high LDL (${inputs.ldlMgDl} ${config.unit}) — clinician review.`,
      severity: "urgent",
    });
  }
  if (
    inputs.nonHdlMgDl !== null &&
    inputs.nonHdlMgDl >= config.escalation_mg_dl.very_high_non_hdl
  ) {
    escalations.push({
      code: "very_high_non_hdl",
      label: `Very high Non-HDL (${inputs.nonHdlMgDl} ${config.unit}) — clinician review.`,
      severity: "urgent",
    });
  }
  if (
    inputs.onLipidLoweringTherapy &&
    inputs.nonHdlMgDl !== null &&
    inputs.previousNonHdlMgDl !== null &&
    inputs.nonHdlMgDl >
      inputs.previousNonHdlMgDl * (1 + config.escalation_mg_dl.worsening_trend_pct / 100)
  ) {
    escalations.push({
      code: "worsening_trend_on_treatment",
      label: `Non-HDL rising despite treatment (${inputs.previousNonHdlMgDl} → ${inputs.nonHdlMgDl} ${config.unit}) — clinician review.`,
      severity: "review",
    });
  }
  if (inputs.onLipidLoweringTherapy && atTarget === false) {
    escalations.push({
      code: "not_at_target_on_treatment",
      label: "On treatment but above LDL/Non-HDL target — clinician review.",
      severity: "review",
    });
  }

  return {
    preventionCategory,
    riskCategory,
    ldlTargetMgDl,
    nonHdlTargetMgDl,
    atTarget,
    statinRecommendation,
    escalations,
    configSigned: opts.configSigned,
    populationNote: config.population_note,
    rationale,
  };
}
