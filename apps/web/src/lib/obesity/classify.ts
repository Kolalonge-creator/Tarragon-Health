/**
 * Obesity classification helpers — TH-CP-OB-001 §6, §9, §13, §14.
 *
 * Pure, deterministic, and testable. These functions compute the *objective*
 * measures the pathway defines (BMI category, waist risk, waist-to-height
 * ratio, treatment-eligibility thresholds).
 *
 * TRUST-MODEL BOUNDARY (docs/CLINICAL_TRUST_MODEL_SPEC.md, docx §1.7):
 * software never makes the health judgement. The clinical-vs-preclinical
 * distinction and Edmonton stage are DOCTOR decisions — this module only
 * *suggests* a status from whether complications/functional limits were
 * recorded, always with a rationale, and the stored value is doctor-set.
 * Nothing here tells a patient they are "healthy", "obese", or "cured".
 */

export type Sex = "male" | "female";

export type BmiCategory =
  | "underweight"
  | "healthy"
  | "overweight"
  | "obesity_class_i"
  | "obesity_class_ii"
  | "obesity_class_iii";

export type WaistRisk = "normal" | "raised" | "high";

/** Doctor-owned; software only ever *suggests* one of these. */
export type ClinicalStatus = "preclinical" | "clinical";

/** BMI = weight(kg) / height(m)². Returns null on non-positive inputs. */
export function computeBmi(weightKg: number, heightCm: number): number | null {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** §6.1 WHO BMI bands. */
export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "healthy";
  if (bmi < 30) return "overweight";
  if (bmi < 35) return "obesity_class_i";
  if (bmi < 40) return "obesity_class_ii";
  return "obesity_class_iii";
}

/**
 * §6.2 waist-circumference risk, sex-specific.
 * Men: raised ≥94, high ≥102. Women: raised ≥80, high ≥88.
 * (Pragmatic cut-offs; no African-specific thresholds established — [LOCALISE].)
 */
export function waistRisk(waistCm: number, sex: Sex): WaistRisk {
  const [raised, high] = sex === "male" ? [94, 102] : [80, 88];
  if (waistCm >= high) return "high";
  if (waistCm >= raised) return "raised";
  return "normal";
}

/** §6.2 waist-to-height ratio; > 0.5 indicates raised central adiposity. */
export function waistToHeightRatio(waistCm: number, heightCm: number): number | null {
  if (!(waistCm > 0) || !(heightCm > 0)) return null;
  return waistCm / heightCm;
}

/**
 * Whether excess adiposity is CONFIRMED (docx §6.2: confirm BMI with a measure
 * of adiposity). True when the patient is in the overweight+ BMI range AND
 * waist risk is raised/high OR WHtR > 0.5.
 */
export function adiposityConfirmed(input: {
  bmi: number;
  waistCm?: number | null;
  heightCm: number;
  sex: Sex;
}): boolean {
  if (input.bmi < 25) return false;
  if (input.bmi >= 30) return true; // BMI alone is diagnostic in the obese range
  if (input.waistCm == null) return false;
  const whtr = waistToHeightRatio(input.waistCm, input.heightCm);
  return waistRisk(input.waistCm, input.sex) !== "normal" || (whtr != null && whtr > 0.5);
}

/**
 * §13.1 anti-obesity medication eligibility (an ADJUNCT to lifestyle, never a
 * replacement — an active eating disorder / pregnancy contraindicates it, which
 * the caller enforces separately). BMI ≥ 30, OR BMI ≥ 27 with a weight-related
 * complication.
 */
export function aomEligible(bmi: number, hasWeightRelatedComplication: boolean): boolean {
  if (bmi >= 30) return true;
  return bmi >= 27 && hasWeightRelatedComplication;
}

/**
 * §14.1 metabolic/bariatric-surgery referral eligibility.
 * BMI ≥ 40; OR BMI ≥ 35 with an obesity-related complication;
 * OR BMI 30–34.9 with type 2 diabetes not controlled by other means.
 */
export function bariatricReferralEligible(input: {
  bmi: number;
  hasObesityComplication: boolean;
  hasUncontrolledT2dm: boolean;
}): boolean {
  if (input.bmi >= 40) return true;
  if (input.bmi >= 35 && input.hasObesityComplication) return true;
  return input.bmi >= 30 && input.bmi < 35 && input.hasUncontrolledT2dm;
}

/**
 * SUGGEST (never decide) clinical vs preclinical from whether the doctor has
 * recorded any complication or functional limitation. §4.2 / §6.3: present →
 * clinical (a disease); absent → preclinical (a risk state). The doctor
 * confirms; this only pre-fills and explains.
 */
export function suggestClinicalStatus(input: {
  hasComplication: boolean;
  functionalLimitation: boolean;
}): { suggested: ClinicalStatus; rationale: string } {
  if (input.hasComplication || input.functionalLimitation) {
    return {
      suggested: "clinical",
      rationale:
        "A complication or functional limitation was recorded — excess adiposity is affecting organ function or daily activity.",
    };
  }
  return {
    suggested: "preclinical",
    rationale:
      "No complication or functional limitation recorded — a risk state to monitor and reduce, not yet an organ-affecting disease.",
  };
}

export interface ObesityClassification {
  bmi: number | null;
  bmiCategory: BmiCategory | null;
  waistRisk: WaistRisk | null;
  whtr: number | null;
  whtrRaised: boolean | null;
  adiposityConfirmed: boolean | null;
}

/**
 * One-shot objective classification from raw measurements. Returns nulls where
 * an input is missing rather than guessing. Waist-derived fields are null when
 * no waist is supplied (BMI-only assessment).
 */
export function classifyObesity(input: {
  weightKg: number;
  heightCm: number;
  waistCm?: number | null;
  sex: Sex;
}): ObesityClassification {
  const bmi = computeBmi(input.weightKg, input.heightCm);
  if (bmi == null) {
    return {
      bmi: null,
      bmiCategory: null,
      waistRisk: null,
      whtr: null,
      whtrRaised: null,
      adiposityConfirmed: null,
    };
  }
  const hasWaist = input.waistCm != null && input.waistCm > 0;
  const whtr = hasWaist ? waistToHeightRatio(input.waistCm as number, input.heightCm) : null;
  return {
    bmi,
    bmiCategory: bmiCategory(bmi),
    waistRisk: hasWaist ? waistRisk(input.waistCm as number, input.sex) : null,
    whtr,
    whtrRaised: whtr == null ? null : whtr > 0.5,
    adiposityConfirmed: adiposityConfirmed({
      bmi,
      waistCm: input.waistCm,
      heightCm: input.heightCm,
      sex: input.sex,
    }),
  };
}

/** Edmonton Obesity Staging System labels (0–4) — reference for the doctor UI. */
export const EOSS_STAGES: { stage: number; label: string; description: string }[] = [
  { stage: 0, label: "Stage 0", description: "No apparent risk factors, symptoms or functional limitation." },
  { stage: 1, label: "Stage 1", description: "Subclinical risk factors, mild symptoms or mild functional limitation." },
  { stage: 2, label: "Stage 2", description: "Established comorbidity or moderate functional/psychological limitation." },
  { stage: 3, label: "Stage 3", description: "End-organ damage or significant functional/psychological limitation." },
  { stage: 4, label: "Stage 4", description: "Severe, potentially end-stage comorbidity or disability." },
];
