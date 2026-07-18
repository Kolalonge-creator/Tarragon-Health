import { describe, expect, it } from "@jest/globals";
import {
  computePreventiveProgrammeRecommendations,
  type ProgrammeRiskInput,
} from "./preventive-programme-recommendations";

function codes(scores: ProgrammeRiskInput[], profile: { sex: "male" | "female" | null; ageYears: number | null }) {
  return computePreventiveProgrammeRecommendations(scores, profile).map((r) => r.code);
}

describe("computePreventiveProgrammeRecommendations", () => {
  it("always recommends the Annual Health Check", () => {
    expect(codes([], { sex: null, ageYears: null })).toContain("annual_health_check");
  });

  it("recommends cardiometabolic prevention when any cardiometabolic tier is moderate+", () => {
    expect(
      codes([{ condition: "hypertension", tier: "moderate" }], { sex: "male", ageYears: 30 }),
    ).toContain("cardiometabolic_prevention");
    expect(
      codes([{ condition: "diabetes", tier: "high" }], { sex: "female", ageYears: 30 }),
    ).toContain("cardiometabolic_prevention");
  });

  it("does not recommend cardiometabolic prevention when all such tiers are low", () => {
    expect(
      codes([{ condition: "cvd", tier: "low" }], { sex: "male", ageYears: 30 }),
    ).not.toContain("cardiometabolic_prevention");
  });

  it("recommends women's health for women 21+ and men's health for men 40+", () => {
    expect(codes([], { sex: "female", ageYears: 30 })).toContain("womens_health");
    expect(codes([], { sex: "female", ageYears: 30 })).not.toContain("mens_health");
    expect(codes([], { sex: "male", ageYears: 45 })).toContain("mens_health");
    expect(codes([], { sex: "male", ageYears: 30 })).not.toContain("mens_health");
  });

  it("recommends cancer screening from age 45", () => {
    expect(codes([], { sex: "female", ageYears: 50 })).toContain("cancer_screening");
    expect(codes([], { sex: "female", ageYears: 40 })).not.toContain("cancer_screening");
  });

  it("returns unique, defensible recommendations without duplicates", () => {
    const result = codes(
      [{ condition: "hypertension", tier: "high" }],
      { sex: "male", ageYears: 50 },
    );
    expect(new Set(result).size).toBe(result.length);
  });

  it("handles a null age/sex gracefully (only the universal check)", () => {
    expect(codes([], { sex: null, ageYears: null })).toEqual(["annual_health_check"]);
  });
});
