import { classifyGlucose, suspectsType1, type GlucoseAssessmentInput } from "./glucose-red-flags";

function input(partial: Partial<GlucoseAssessmentInput>): GlucoseAssessmentInput {
  return {
    latestGlucose: null,
    latestKetoneMmol: null,
    latestKetoneUrine: null,
    recentGlucose: [],
    ...partial,
  };
}

describe("classifyGlucose", () => {
  it("flags severe hypoglycaemia (<3.0) as an emergency", () => {
    const flag = classifyGlucose(input({ latestGlucose: 2.4, recentGlucose: [2.4] }));
    expect(flag.tier).toBe("emergency");
    expect(flag.kind).toBe("severe_hypo");
  });

  it("flags suspected DKA (high glucose + high blood ketones) as an emergency", () => {
    const flag = classifyGlucose(
      input({ latestGlucose: 19, latestKetoneMmol: 3.4, recentGlucose: [19] }),
    );
    expect(flag.tier).toBe("emergency");
    expect(flag.kind).toBe("suspected_dka");
  });

  it("flags suspected DKA on high glucose + large urine ketones", () => {
    const flag = classifyGlucose(
      input({ latestGlucose: 22, latestKetoneUrine: "large", recentGlucose: [22] }),
    );
    // very_high would be urgent, but DKA (emergency) must win on severity
    expect(flag.tier).toBe("emergency");
    expect(flag.kind).toBe("suspected_dka");
  });

  it("flags a mild hypo (3.0–3.8) as urgent / same-day", () => {
    const flag = classifyGlucose(input({ latestGlucose: 3.5, recentGlucose: [3.5] }));
    expect(flag.tier).toBe("urgent");
    expect(flag.kind).toBe("hypo_alert");
  });

  it("flags a very high glucose (>=20) with no ketones as urgent", () => {
    const flag = classifyGlucose(input({ latestGlucose: 24, recentGlucose: [24] }));
    expect(flag.tier).toBe("urgent");
    expect(flag.kind).toBe("very_high");
  });

  it("flags raised ketones alone (no high glucose) as urgent DKA workflow", () => {
    const flag = classifyGlucose(input({ latestGlucose: 8, latestKetoneMmol: 3.1, recentGlucose: [8] }));
    expect(flag.tier).toBe("urgent");
    expect(flag.kind).toBe("ketones_raised");
  });

  it("flags persistent hyperglycaemia (>=3 readings >14) as amber", () => {
    const flag = classifyGlucose(input({ latestGlucose: 12, recentGlucose: [12, 15, 16, 17] }));
    expect(flag.tier).toBe("amber");
    expect(flag.kind).toBe("persistent_hyperglycaemia");
  });

  it("flags recurrent hypos (>=2 lows) as amber", () => {
    const flag = classifyGlucose(input({ latestGlucose: 6, recentGlucose: [6, 3.6, 3.2] }));
    expect(flag.tier).toBe("amber");
    expect(flag.kind).toBe("recurrent_hypo");
  });

  it("flags moderate ketones as amber", () => {
    const flag = classifyGlucose(input({ latestGlucose: 9, latestKetoneMmol: 1.8, recentGlucose: [9] }));
    expect(flag.tier).toBe("amber");
    expect(flag.kind).toBe("ketones_moderate");
  });

  it("returns none for an in-range reading", () => {
    const flag = classifyGlucose(input({ latestGlucose: 6.2, recentGlucose: [6.2, 5.8, 7.1] }));
    expect(flag.tier).toBe("none");
  });

  it("never reassures on a boundary just above severe hypo (3.0 is still a hypo alert)", () => {
    const flag = classifyGlucose(input({ latestGlucose: 3.0, recentGlucose: [3.0] }));
    expect(flag.tier).toBe("urgent");
    expect(flag.kind).toBe("hypo_alert");
  });

  it("boundary: exactly 3.9 is in range (not a hypo)", () => {
    const flag = classifyGlucose(input({ latestGlucose: 3.9, recentGlucose: [3.9] }));
    expect(flag.tier).toBe("none");
  });

  it("relaxes ONLY the persistent-high band for a relaxed target (safety fixed)", () => {
    const readings = [15, 15.5, 16]; // trips persistent-high at default 14
    expect(classifyGlucose(input({ latestGlucose: 15, recentGlucose: readings })).kind).toBe(
      "persistent_hyperglycaemia",
    );
    // with a relaxed threshold of 18, these no longer trip amber
    expect(
      classifyGlucose(input({ latestGlucose: 15, recentGlucose: readings }), {
        persistentHighThreshold: 18,
      }).tier,
    ).toBe("none");
  });

  it("never lets an override tighten below the guideline default", () => {
    // override of 5 must not make a normal 8 count as 'high'
    const flag = classifyGlucose(input({ latestGlucose: 8, recentGlucose: [8, 9, 8.5] }), {
      persistentHighThreshold: 5,
    });
    expect(flag.tier).toBe("none");
  });

  it("severe hypo stays an emergency even with a relaxed target (safety never relaxed)", () => {
    const flag = classifyGlucose(input({ latestGlucose: 2.5, recentGlucose: [2.5] }), {
      persistentHighThreshold: 18,
    });
    expect(flag.tier).toBe("emergency");
  });
});

describe("suspectsType1", () => {
  it("suspects a young lean patient", () => {
    expect(suspectsType1({ ageYears: 24, bmi: 21 })).toBe(true);
  });
  it("errs toward suspicion for a young patient with unknown BMI", () => {
    expect(suspectsType1({ ageYears: 30, bmi: null })).toBe(true);
  });
  it("does not suspect an older or overweight patient", () => {
    expect(suspectsType1({ ageYears: 55, bmi: null })).toBe(false);
    expect(suspectsType1({ ageYears: 30, bmi: 31 })).toBe(false);
  });
  it("does not suspect when age is unknown", () => {
    expect(suspectsType1({ ageYears: null, bmi: null })).toBe(false);
  });
});
