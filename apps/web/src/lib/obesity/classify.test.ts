import {
  computeBmi,
  bmiCategory,
  waistRisk,
  waistToHeightRatio,
  adiposityConfirmed,
  aomEligible,
  bariatricReferralEligible,
  suggestClinicalStatus,
  classifyObesity,
} from "./classify";

describe("computeBmi", () => {
  it("computes kg/m²", () => {
    expect(computeBmi(81, 180)).toBeCloseTo(25, 1);
  });
  it("returns null on non-positive inputs", () => {
    expect(computeBmi(0, 180)).toBeNull();
    expect(computeBmi(80, 0)).toBeNull();
  });
});

describe("bmiCategory (§6.1 boundaries)", () => {
  it.each([
    [17, "underweight"],
    [18.5, "healthy"],
    [24.9, "healthy"],
    [25, "overweight"],
    [29.9, "overweight"],
    [30, "obesity_class_i"],
    [34.9, "obesity_class_i"],
    [35, "obesity_class_ii"],
    [39.9, "obesity_class_ii"],
    [40, "obesity_class_iii"],
    [55, "obesity_class_iii"],
  ])("bmi %s → %s", (bmi, expected) => {
    expect(bmiCategory(bmi as number)).toBe(expected);
  });
});

describe("waistRisk (§6.2 sex-specific)", () => {
  it("men: raised ≥94, high ≥102", () => {
    expect(waistRisk(93, "male")).toBe("normal");
    expect(waistRisk(94, "male")).toBe("raised");
    expect(waistRisk(101, "male")).toBe("raised");
    expect(waistRisk(102, "male")).toBe("high");
  });
  it("women: raised ≥80, high ≥88", () => {
    expect(waistRisk(79, "female")).toBe("normal");
    expect(waistRisk(80, "female")).toBe("raised");
    expect(waistRisk(87, "female")).toBe("raised");
    expect(waistRisk(88, "female")).toBe("high");
  });
});

describe("waistToHeightRatio", () => {
  it("> 0.5 is the raised threshold", () => {
    expect(waistToHeightRatio(90, 170)).toBeCloseTo(0.529, 2);
    expect(waistToHeightRatio(0, 170)).toBeNull();
  });
});

describe("adiposityConfirmed (§6.2)", () => {
  it("BMI < 25 is never confirmed", () => {
    expect(adiposityConfirmed({ bmi: 24, waistCm: 110, heightCm: 170, sex: "male" })).toBe(false);
  });
  it("BMI ≥ 30 confirmed on BMI alone", () => {
    expect(adiposityConfirmed({ bmi: 31, waistCm: null, heightCm: 170, sex: "male" })).toBe(true);
  });
  it("overweight range needs a raised waist or WHtR>0.5", () => {
    // 170cm male, waist 90 → normal waist, WHtR 0.529 > 0.5 → confirmed
    expect(adiposityConfirmed({ bmi: 27, waistCm: 90, heightCm: 170, sex: "male" })).toBe(true);
    // waist 88 male → normal, WHtR 0.49 → not confirmed
    expect(adiposityConfirmed({ bmi: 27, waistCm: 82, heightCm: 170, sex: "male" })).toBe(false);
    // no waist supplied in overweight range → cannot confirm
    expect(adiposityConfirmed({ bmi: 27, waistCm: null, heightCm: 170, sex: "male" })).toBe(false);
  });
});

describe("aomEligible (§13.1)", () => {
  it("BMI ≥ 30 always", () => {
    expect(aomEligible(30, false)).toBe(true);
  });
  it("BMI ≥ 27 only with a complication", () => {
    expect(aomEligible(27, true)).toBe(true);
    expect(aomEligible(27, false)).toBe(false);
    expect(aomEligible(26, true)).toBe(false);
  });
});

describe("bariatricReferralEligible (§14.1)", () => {
  it("BMI ≥ 40 regardless", () => {
    expect(bariatricReferralEligible({ bmi: 40, hasObesityComplication: false, hasUncontrolledT2dm: false })).toBe(true);
  });
  it("BMI ≥ 35 with a complication", () => {
    expect(bariatricReferralEligible({ bmi: 36, hasObesityComplication: true, hasUncontrolledT2dm: false })).toBe(true);
    expect(bariatricReferralEligible({ bmi: 36, hasObesityComplication: false, hasUncontrolledT2dm: false })).toBe(false);
  });
  it("BMI 30–34.9 only with uncontrolled T2DM", () => {
    expect(bariatricReferralEligible({ bmi: 32, hasObesityComplication: false, hasUncontrolledT2dm: true })).toBe(true);
    expect(bariatricReferralEligible({ bmi: 32, hasObesityComplication: true, hasUncontrolledT2dm: false })).toBe(false);
    expect(bariatricReferralEligible({ bmi: 29, hasObesityComplication: false, hasUncontrolledT2dm: true })).toBe(false);
  });
});

describe("suggestClinicalStatus (never decides — §1.7)", () => {
  it("complication or functional limit → suggests clinical", () => {
    expect(suggestClinicalStatus({ hasComplication: true, functionalLimitation: false }).suggested).toBe("clinical");
    expect(suggestClinicalStatus({ hasComplication: false, functionalLimitation: true }).suggested).toBe("clinical");
  });
  it("neither → suggests preclinical", () => {
    expect(suggestClinicalStatus({ hasComplication: false, functionalLimitation: false }).suggested).toBe("preclinical");
  });
  it("always returns a rationale", () => {
    expect(suggestClinicalStatus({ hasComplication: true, functionalLimitation: false }).rationale.length).toBeGreaterThan(0);
  });
});

describe("classifyObesity", () => {
  it("full classification with waist", () => {
    const r = classifyObesity({ weightKg: 100, heightCm: 170, waistCm: 105, sex: "male" });
    expect(r.bmiCategory).toBe("obesity_class_i");
    expect(r.waistRisk).toBe("high");
    expect(r.whtrRaised).toBe(true);
    expect(r.adiposityConfirmed).toBe(true);
  });
  it("BMI-only assessment leaves waist fields null", () => {
    const r = classifyObesity({ weightKg: 100, heightCm: 170, waistCm: null, sex: "female" });
    expect(r.bmiCategory).toBe("obesity_class_i");
    expect(r.waistRisk).toBeNull();
    expect(r.whtr).toBeNull();
    expect(r.whtrRaised).toBeNull();
    expect(r.adiposityConfirmed).toBe(true); // BMI ≥ 30
  });
  it("invalid measurements → all null", () => {
    const r = classifyObesity({ weightKg: 0, heightCm: 170, waistCm: 90, sex: "male" });
    expect(r.bmi).toBeNull();
    expect(r.bmiCategory).toBeNull();
  });
});
