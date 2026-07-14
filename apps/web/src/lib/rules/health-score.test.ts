import { describe, expect, it } from "@jest/globals";
import { computeHealthScore, type HealthScoreInputs } from "./health-score";

const allUnavailable: HealthScoreInputs = {
  bpControlPercent: null,
  latestHba1cPercent: null,
  screeningCompliancePercent: null,
  bmi: null,
  smokingStatus: null,
  cigarettesPerDay: null,
};

describe("computeHealthScore", () => {
  it("returns null when no component data is available", () => {
    expect(computeHealthScore(allUnavailable)).toBeNull();
  });

  it("scores a fully healthy profile near 100", () => {
    const result = computeHealthScore({
      bpControlPercent: 100,
      latestHba1cPercent: 5.2,
      screeningCompliancePercent: 100,
      bmi: 22,
      smokingStatus: "never",
      cigarettesPerDay: null,
    });
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(95);
    expect(result!.riskLevel).toBe("low");
  });

  it("scores a poor profile low", () => {
    const result = computeHealthScore({
      bpControlPercent: 10,
      latestHba1cPercent: 9.5,
      screeningCompliancePercent: 0,
      bmi: 34,
      smokingStatus: "current",
      cigarettesPerDay: "20_plus",
    });
    expect(result).not.toBeNull();
    expect(result!.score).toBeLessThan(40);
    expect(result!.riskLevel).toBe("very_high");
  });

  it("redistributes weight across only the available components", () => {
    const result = computeHealthScore({
      ...allUnavailable,
      bmi: 22,
      smokingStatus: "never",
    });
    expect(result).not.toBeNull();
    expect(result!.components).toHaveLength(2);
    expect(result!.score).toBeGreaterThanOrEqual(95);
  });

  it("does not penalise a missing HbA1c reading", () => {
    const withHba1c = computeHealthScore({
      bpControlPercent: 100,
      latestHba1cPercent: 5.2,
      screeningCompliancePercent: 100,
      bmi: 22,
      smokingStatus: "never",
      cigarettesPerDay: null,
    });
    const withoutHba1c = computeHealthScore({
      bpControlPercent: 100,
      latestHba1cPercent: null,
      screeningCompliancePercent: 100,
      bmi: 22,
      smokingStatus: "never",
      cigarettesPerDay: null,
    });
    expect(withoutHba1c!.score).toBeGreaterThanOrEqual(withHba1c!.score - 2);
  });

  it("scores former smokers between never and current", () => {
    const never = computeHealthScore({ ...allUnavailable, smokingStatus: "never" })!;
    const former = computeHealthScore({ ...allUnavailable, smokingStatus: "former" })!;
    const current = computeHealthScore({
      ...allUnavailable,
      smokingStatus: "current",
      cigarettesPerDay: "20_plus",
    })!;
    expect(never.score).toBeGreaterThan(former.score);
    expect(former.score).toBeGreaterThan(current.score);
  });
});
