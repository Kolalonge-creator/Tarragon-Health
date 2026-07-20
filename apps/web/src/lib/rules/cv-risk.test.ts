import { describe, it, expect } from "@jest/globals";
import {
  assessCvRisk,
  PROVISIONAL_CV_RISK_CONFIG,
  type CvRiskInputs,
  type CardiovascularProfile,
} from "./cv-risk";

const noProfile: CardiovascularProfile = {
  established_ascvd: false,
  prior_mi: false,
  prior_stroke_tia: false,
  prior_pad: false,
  prior_revascularisation: false,
  familial_hypercholesterolaemia: false,
};

function baseInputs(overrides: Partial<CvRiskInputs> = {}): CvRiskInputs {
  return {
    age: 55,
    sex: "male",
    ldlMgDl: null,
    nonHdlMgDl: null,
    previousNonHdlMgDl: null,
    tenYearRiskPct: null,
    tenYearRiskLevel: null,
    diabetes: false,
    cvProfile: noProfile,
    onLipidLoweringTherapy: false,
    ...overrides,
  };
}

const signed = { configSigned: true };

describe("assessCvRisk — secondary prevention", () => {
  it("flags an untreated patient with a prior MI as urgent and applies tight targets", () => {
    const a = assessCvRisk(
      baseInputs({ cvProfile: { ...noProfile, prior_mi: true }, onLipidLoweringTherapy: false }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.preventionCategory).toBe("secondary");
    expect(a.riskCategory).toBe("very_high");
    expect(a.statinRecommendation).toBe("secondary_prevention_recommended");
    expect(a.ldlTargetMgDl).toBe(70);
    expect(a.nonHdlTargetMgDl).toBe(100);
    expect(a.escalations.map((e) => e.code)).toContain("untreated_secondary_prevention");
  });

  it("does not raise the untreated flag when the patient is already on therapy", () => {
    const a = assessCvRisk(
      baseInputs({ cvProfile: { ...noProfile, prior_stroke_tia: true }, onLipidLoweringTherapy: true }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.escalations.map((e) => e.code)).not.toContain("untreated_secondary_prevention");
  });

  it("treats diabetes at/over the config age as secondary/near-automatic", () => {
    const a = assessCvRisk(
      baseInputs({ diabetes: true, age: 41 }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.preventionCategory).toBe("secondary");
    expect(a.statinRecommendation).toBe("secondary_prevention_recommended");
  });

  it("does NOT treat young diabetes (below the config age) as secondary", () => {
    const a = assessCvRisk(
      baseInputs({ diabetes: true, age: 30, tenYearRiskPct: 3 }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.preventionCategory).toBe("primary");
  });
});

describe("assessCvRisk — primary prevention", () => {
  it("recommends a lifestyle-first statin conversation above the risk threshold", () => {
    const a = assessCvRisk(
      baseInputs({ tenYearRiskPct: 15, tenYearRiskLevel: "high" }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.preventionCategory).toBe("primary");
    expect(a.statinRecommendation).toBe("primary_risk_based_recommended");
    // never an automatic prescription — no untreated escalation for primary
    expect(a.escalations.map((e) => e.code)).not.toContain("untreated_secondary_prevention");
  });

  it("is lifestyle-first below the threshold", () => {
    const a = assessCvRisk(
      baseInputs({ tenYearRiskPct: 4, tenYearRiskLevel: "low" }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.statinRecommendation).toBe("primary_lifestyle_first");
  });

  it("returns insufficient_data when there is no risk estimate", () => {
    const a = assessCvRisk(baseInputs({ tenYearRiskPct: null }), PROVISIONAL_CV_RISK_CONFIG, signed);
    expect(a.statinRecommendation).toBe("insufficient_data");
  });
});

describe("assessCvRisk — escalations driven by config thresholds", () => {
  it("escalates very high LDL and Non-HDL", () => {
    const a = assessCvRisk(
      baseInputs({ ldlMgDl: 200, nonHdlMgDl: 230 }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    const codes = a.escalations.map((e) => e.code);
    expect(codes).toContain("very_high_ldl");
    expect(codes).toContain("very_high_non_hdl");
  });

  it("escalates a worsening Non-HDL trend despite treatment", () => {
    const a = assessCvRisk(
      baseInputs({
        cvProfile: { ...noProfile, prior_mi: true },
        onLipidLoweringTherapy: true,
        previousNonHdlMgDl: 100,
        nonHdlMgDl: 120, // +20% > 10% threshold
      }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.escalations.map((e) => e.code)).toContain("worsening_trend_on_treatment");
  });

  it("flags not-at-target while on treatment", () => {
    const a = assessCvRisk(
      baseInputs({
        cvProfile: { ...noProfile, prior_mi: true },
        onLipidLoweringTherapy: true,
        nonHdlMgDl: 130, // above the secondary target of 100
      }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.atTarget).toBe(false);
    expect(a.escalations.map((e) => e.code)).toContain("not_at_target_on_treatment");
  });

  it("marks atTarget true when Non-HDL is within target", () => {
    const a = assessCvRisk(
      baseInputs({ cvProfile: { ...noProfile, prior_mi: true }, nonHdlMgDl: 90 }),
      PROVISIONAL_CV_RISK_CONFIG,
      signed
    );
    expect(a.atTarget).toBe(true);
  });
});

describe("assessCvRisk — config provenance", () => {
  it("passes through configSigned = false for provisional config", () => {
    const a = assessCvRisk(baseInputs(), PROVISIONAL_CV_RISK_CONFIG, { configSigned: false });
    expect(a.configSigned).toBe(false);
    expect(a.populationNote).toMatch(/not validated for Sub-Saharan African/i);
  });
});
