import { describe, expect, it } from "@jest/globals";
import {
  computeHealthScore,
  getHealthScoreTips,
  computeHealthScoreTrend,
  describeHealthScoreTrend,
  type HealthScoreInputs,
  type HealthScoreTrendPoint,
} from "./health-score";

const allUnavailable: HealthScoreInputs = {
  bpControlPercent: null,
  latestHba1cPercent: null,
  screeningCompliancePercent: null,
  vaccinationCompliancePercent: null,
  bmi: null,
  smokingStatus: null,
  cigarettesPerDay: null,
  heartBiomarkerStatus: null,
  kidneyBiomarkerStatus: null,
  liverBiomarkerStatus: null,
};

const fullyHealthy: HealthScoreInputs = {
  bpControlPercent: 100,
  latestHba1cPercent: 5.2,
  screeningCompliancePercent: 100,
  vaccinationCompliancePercent: 100,
  bmi: 22,
  smokingStatus: "never",
  cigarettesPerDay: null,
  heartBiomarkerStatus: "good",
  kidneyBiomarkerStatus: "good",
  liverBiomarkerStatus: "good",
};

describe("computeHealthScore", () => {
  it("returns null when no component data is available", () => {
    expect(computeHealthScore(allUnavailable)).toBeNull();
  });

  it("scores a fully healthy profile near 100", () => {
    const result = computeHealthScore(fullyHealthy);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(95);
    expect(result!.riskLevel).toBe("low");
  });

  it("scores a poor profile low", () => {
    const result = computeHealthScore({
      bpControlPercent: 10,
      latestHba1cPercent: 9.5,
      screeningCompliancePercent: 0,
      vaccinationCompliancePercent: 0,
      bmi: 34,
      smokingStatus: "current",
      cigarettesPerDay: "20_plus",
      heartBiomarkerStatus: "needs_attention",
      kidneyBiomarkerStatus: "needs_attention",
      liverBiomarkerStatus: "needs_attention",
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
    const withHba1c = computeHealthScore({ ...fullyHealthy, vaccinationCompliancePercent: null });
    const withoutHba1c = computeHealthScore({
      ...fullyHealthy,
      latestHba1cPercent: null,
      vaccinationCompliancePercent: null,
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

  it("scores vaccination compliance only when something is due, like screening compliance", () => {
    const withVax = computeHealthScore({ ...allUnavailable, vaccinationCompliancePercent: 50 })!;
    expect(withVax.components).toHaveLength(1);
    expect(withVax.components[0].key).toBe("vaccination");
    expect(withVax.score).toBe(50);
    // a patient with no generated vaccination schedule is never penalised
    expect(computeHealthScore(allUnavailable)).toBeNull();
  });

  it("includes the real HbA1c value with its bracket as the hba1c component's detail", () => {
    const result = computeHealthScore({ ...allUnavailable, latestHba1cPercent: 5.9 })!;
    const hba1c = result.components.find((c) => c.key === "hba1c");
    expect(hba1c?.detail).toBe("41 mmol/mol (5.9%, Prediabetic range)");
  });

  it("scores each biomarker category only when a reviewed status exists for it", () => {
    const heartOnly = computeHealthScore({ ...allUnavailable, heartBiomarkerStatus: "good" })!;
    expect(heartOnly.components).toHaveLength(1);
    expect(heartOnly.components[0].key).toBe("biomarker_heart");
    expect(heartOnly.components[0].value).toBe(100);
    expect(heartOnly.components[0].detail).toBe("From your reviewed lab results");
    // no reviewed panel for any category yet: none of the three appear, and
    // a patient with nothing else logged still gets no score at all
    expect(computeHealthScore(allUnavailable)).toBeNull();
  });

  it("scores a needs_attention biomarker category well below good, but not to zero", () => {
    const result = computeHealthScore({
      ...allUnavailable,
      kidneyBiomarkerStatus: "needs_attention",
    })!;
    const kidney = result.components.find((c) => c.key === "biomarker_kidney");
    expect(kidney?.value).toBe(40);
  });

  it("scores heart/kidney/liver independently — one flagged category doesn't affect the others", () => {
    const result = computeHealthScore({
      ...allUnavailable,
      heartBiomarkerStatus: "needs_attention",
      kidneyBiomarkerStatus: "good",
      liverBiomarkerStatus: "good",
    })!;
    expect(result.components.find((c) => c.key === "biomarker_heart")?.value).toBe(40);
    expect(result.components.find((c) => c.key === "biomarker_kidney")?.value).toBe(100);
    expect(result.components.find((c) => c.key === "biomarker_liver")?.value).toBe(100);
  });
});

describe("getHealthScoreTips", () => {
  it("returns no tips when every component is already at/above threshold", () => {
    const result = computeHealthScore(fullyHealthy)!;
    expect(getHealthScoreTips(result.components)).toEqual([]);
  });

  it("returns a tip for each component below threshold, none for those above", () => {
    const result = computeHealthScore({
      bpControlPercent: 40,
      latestHba1cPercent: null,
      screeningCompliancePercent: 100,
      vaccinationCompliancePercent: null,
      bmi: 22,
      smokingStatus: "current",
      cigarettesPerDay: "20_plus",
      heartBiomarkerStatus: null,
      kidneyBiomarkerStatus: null,
      liverBiomarkerStatus: null,
    })!;
    const tips = getHealthScoreTips(result.components);
    expect(tips).toHaveLength(2);
    expect(tips.some((t) => t.toLowerCase().includes("blood pressure"))).toBe(true);
    expect(tips.some((t) => t.toLowerCase().includes("smoking"))).toBe(true);
  });

  it("returns a tip for a flagged biomarker category", () => {
    const result = computeHealthScore({
      ...allUnavailable,
      liverBiomarkerStatus: "needs_attention",
    })!;
    const tips = getHealthScoreTips(result.components);
    expect(tips).toHaveLength(1);
    expect(tips[0].toLowerCase()).toContain("liver panel");
  });
});

describe("computeHealthScoreTrend", () => {
  it("returns null with fewer than two data points — never fabricates a trend", () => {
    const single: HealthScoreTrendPoint[] = [
      { score: 60, inputs: {}, computed_at: "2026-01-01T00:00:00Z" },
    ];
    expect(computeHealthScoreTrend([])).toBeNull();
    expect(computeHealthScoreTrend(single)).toBeNull();
  });

  it("computes score delta and bmi sub-score delta from the earliest vs latest real snapshots", () => {
    const history: HealthScoreTrendPoint[] = [
      {
        score: 55,
        inputs: { components: [{ key: "bmi", value: 40, weight: 15 }] },
        computed_at: "2026-01-01T00:00:00Z",
      },
      {
        score: 58,
        inputs: { components: [{ key: "bmi", value: 45, weight: 15 }] },
        computed_at: "2026-02-01T00:00:00Z",
      },
      {
        score: 70,
        inputs: { components: [{ key: "bmi", value: 60, weight: 15 }] },
        computed_at: "2026-03-01T00:00:00Z",
      },
    ];
    const trend = computeHealthScoreTrend(history)!;
    expect(trend.firstScore).toBe(55);
    expect(trend.lastScore).toBe(70);
    expect(trend.scoreDelta).toBe(15);
    expect(trend.bmiSubScoreDelta).toBe(20);
  });

  it("leaves bmiSubScoreDelta null when either snapshot has no bmi component", () => {
    const history: HealthScoreTrendPoint[] = [
      { score: 50, inputs: { components: [] }, computed_at: "2026-01-01T00:00:00Z" },
      {
        score: 60,
        inputs: { components: [{ key: "bmi", value: 80, weight: 15 }] },
        computed_at: "2026-02-01T00:00:00Z",
      },
    ];
    expect(computeHealthScoreTrend(history)!.bmiSubScoreDelta).toBeNull();
  });
});

describe("describeHealthScoreTrend", () => {
  it("describes an improving score without alarm and credits weight movement", () => {
    const line = describeHealthScoreTrend({
      firstScore: 55,
      lastScore: 70,
      firstDate: "2026-01-01T00:00:00Z",
      lastDate: "2026-03-01T00:00:00Z",
      scoreDelta: 15,
      bmiSubScoreDelta: 20,
    });
    expect(line).toContain("moved up from 55 to 70");
    expect(line.toLowerCase()).toContain("real, measurable progress");
  });

  it("describes a dip gently, with no fear-based language", () => {
    const line = describeHealthScoreTrend({
      firstScore: 70,
      lastScore: 60,
      firstDate: "2026-01-01T00:00:00Z",
      lastDate: "2026-03-01T00:00:00Z",
      scoreDelta: -10,
      bmiSubScoreDelta: -5,
    });
    expect(line).toContain("moved from 70 to 60");
    expect(line.toLowerCase()).not.toContain("warning");
    expect(line.toLowerCase()).not.toContain("fail");
    expect(line).toContain("nothing to panic about");
  });

  it("omits any weight-specific line when bmiSubScoreDelta is null or negligible", () => {
    const steady = describeHealthScoreTrend({
      firstScore: 60,
      lastScore: 60,
      firstDate: "2026-01-01T00:00:00Z",
      lastDate: "2026-03-01T00:00:00Z",
      scoreDelta: 0,
      bmiSubScoreDelta: null,
    });
    expect(steady).toBe("Since your first check, your Health Score has held steady at 60.");
  });
});
