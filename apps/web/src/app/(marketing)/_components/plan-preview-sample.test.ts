import { buildSamplePlan } from "./plan-preview-sample";

/**
 * buildSamplePlan is a pure, illustrative mapping only — it must never be
 * mistaken for the real recommendation engine
 * (lib/rules/care-programme-recommendations.ts), which only ever runs
 * against a real signed-in health profile. These tests pin the deliberate
 * routing decisions and age/sex gating.
 */
describe("buildSamplePlan", () => {
  it("redirects an existing-condition answer to chronic care instead of building a calendar", () => {
    const plan = buildSamplePlan("40-59", "female", "existing-condition");
    expect(plan.kind).toBe("redirect");
    if (plan.kind === "redirect") {
      expect(plan.message).toContain("chronic care");
    }
  });

  it("includes cervical screening for women 25+, not under 25", () => {
    const under25 = buildSamplePlan("under25", "female", "healthy");
    const over25 = buildSamplePlan("25-39", "female", "healthy");
    expect(under25.kind).toBe("example");
    expect(over25.kind).toBe("example");
    if (under25.kind === "example" && over25.kind === "example") {
      expect(under25.calendar.some((i) => i.includes("Cervical smear"))).toBe(false);
      expect(over25.calendar.some((i) => i.includes("Cervical smear"))).toBe(true);
    }
  });

  it("includes breast screening for women 40+ only", () => {
    const younger = buildSamplePlan("25-39", "female", "healthy");
    const older = buildSamplePlan("40-59", "female", "healthy");
    if (younger.kind === "example" && older.kind === "example") {
      expect(younger.calendar.some((i) => i.includes("Breast screening"))).toBe(false);
      expect(older.calendar.some((i) => i.includes("Breast screening"))).toBe(true);
    }
  });

  it("includes prostate and colorectal screening for men 40+ only, never for women", () => {
    const olderMale = buildSamplePlan("40-59", "male", "healthy");
    const youngerMale = buildSamplePlan("25-39", "male", "healthy");
    const olderFemale = buildSamplePlan("40-59", "female", "healthy");
    if (olderMale.kind === "example" && youngerMale.kind === "example" && olderFemale.kind === "example") {
      expect(olderMale.calendar.some((i) => i.includes("PSA prostate"))).toBe(true);
      expect(olderMale.calendar.some((i) => i.includes("Colorectal"))).toBe(true);
      expect(youngerMale.calendar.some((i) => i.includes("PSA prostate"))).toBe(false);
      expect(olderFemale.calendar.some((i) => i.includes("PSA prostate"))).toBe(false);
    }
  });

  it("adds a closer-interval lipid/kidney check only for the family-history answer", () => {
    const healthy = buildSamplePlan("25-39", "male", "healthy");
    const familyHistory = buildSamplePlan("25-39", "male", "family-history");
    if (healthy.kind === "example" && familyHistory.kind === "example") {
      expect(healthy.calendar.some((i) => i.includes("family history"))).toBe(false);
      expect(familyHistory.calendar.some((i) => i.includes("family history"))).toBe(true);
    }
  });

  it("adds the shingles eligibility check only for the 60+ band", () => {
    const midAge = buildSamplePlan("40-59", "male", "healthy");
    const senior = buildSamplePlan("60plus", "male", "healthy");
    if (midAge.kind === "example" && senior.kind === "example") {
      expect(midAge.calendar.some((i) => i.includes("Shingles"))).toBe(false);
      expect(senior.calendar.some((i) => i.includes("Shingles"))).toBe(true);
    }
  });

  it("always includes the universal checks regardless of answers", () => {
    const plan = buildSamplePlan("25-39", "male", "healthy");
    if (plan.kind === "example") {
      expect(plan.calendar.some((i) => i.includes("Blood pressure"))).toBe(true);
      expect(plan.calendar.some((i) => i.includes("HIV and Hepatitis B"))).toBe(true);
      expect(plan.calendar.some((i) => i.includes("vaccination check"))).toBe(true);
      expect(plan.firstNinetyDays).toHaveLength(3);
    }
  });
});
