import { describe, expect, it } from "@jest/globals";
import { buildHealthDomains, HEALTH_DOMAIN_ORDER } from "./domains";

describe("buildHealthDomains", () => {
  it("returns all 9 domains as no_data with no inputs", () => {
    const result = buildHealthDomains({});
    expect(result).toHaveLength(HEALTH_DOMAIN_ORDER.length);
    expect(result.every((d) => d.status === "no_data")).toBe(true);
    expect(result.every((d) => d.narrative === "Nothing logged here yet.")).toBe(true);
  });

  it("marks cardiovascular good from a low-risk cvd_10yr signal", () => {
    const result = buildHealthDomains({
      riskSignals: [{ score_type: "cvd_10yr", risk_level: "low" }],
    });
    const cardio = result.find((d) => d.key === "cardiovascular");
    expect(cardio).toMatchObject({ status: "good" });
  });

  it("marks cardiovascular needing attention from an elevated bp_control signal", () => {
    const result = buildHealthDomains({
      riskSignals: [{ score_type: "bp_control", risk_level: "high" }],
    });
    const cardio = result.find((d) => d.key === "cardiovascular");
    expect(cardio).toMatchObject({ status: "attention" });
  });

  it("never fabricates a status from an unknown or null risk_level", () => {
    const result = buildHealthDomains({
      riskSignals: [
        { score_type: "cvd_10yr", risk_level: "unknown" },
        { score_type: "bp_control", risk_level: null },
      ],
    });
    const cardio = result.find((d) => d.key === "cardiovascular");
    expect(cardio).toMatchObject({ status: "no_data" });
  });

  it("ignores a score_type with no domain mapping (e.g. an adherence signal)", () => {
    const result = buildHealthDomains({
      riskSignals: [{ score_type: "predictive_missed_follow_up", risk_level: "high" }],
    });
    expect(result.every((d) => d.status === "no_data")).toBe(true);
  });

  it("combines a biomarker category into the same domain as a risk signal, attention wins", () => {
    const result = buildHealthDomains({
      riskSignals: [{ score_type: "cvd_10yr", risk_level: "low" }],
      biomarkerCategories: [
        { key: "heart", label: "Heart health", status: "needs_attention", reviewedCount: 1, needsAttentionCount: 1 },
      ],
    });
    const cardio = result.find((d) => d.key === "cardiovascular");
    expect(cardio).toMatchObject({ status: "attention" });
  });

  it("never maps kidney or liver biomarker categories to any of the 9 domains", () => {
    const result = buildHealthDomains({
      biomarkerCategories: [
        { key: "kidney", label: "Kidney health", status: "needs_attention", reviewedCount: 1, needsAttentionCount: 1 },
        { key: "liver", label: "Liver health", status: "needs_attention", reviewedCount: 1, needsAttentionCount: 1 },
      ],
    });
    expect(result.every((d) => d.status === "no_data")).toBe(true);
  });

  it("builds a rhythm & recovery narrative from a real sleep summary", () => {
    const result = buildHealthDomains({
      sleepSummary: {
        lastNightMinutes: 420,
        averageMinutes: 390,
        nightsInWindow: 10,
        consistency: "consistent",
        trend: "flat",
      },
    });
    const rhythm = result.find((d) => d.key === "rhythm_recovery");
    expect(rhythm?.status).toBe("good");
    expect(rhythm?.narrative).toContain("6.5 hours");
    expect(rhythm?.narrative).toContain("10 synced nights");
  });

  it("never asserts a status from too few nights to judge consistency (sleep.consistency 'unknown')", () => {
    const result = buildHealthDomains({
      sleepSummary: {
        lastNightMinutes: 400,
        averageMinutes: 410,
        nightsInWindow: 2,
        consistency: "unknown",
        trend: "unknown",
      },
    });
    const rhythm = result.find((d) => d.key === "rhythm_recovery");
    expect(rhythm?.status).toBe("no_data");
    // Still a plain fact, not a fabricated verdict.
    expect(rhythm?.narrative).toContain("6.8 hours");
  });

  it("maps heart_rate_pattern to cardiovascular, not rhythm_recovery", () => {
    const result = buildHealthDomains({
      riskSignals: [{ score_type: "heart_rate_pattern", risk_level: "high" }],
    });
    expect(result.find((d) => d.key === "cardiovascular")).toMatchObject({ status: "attention" });
    expect(result.find((d) => d.key === "rhythm_recovery")).toMatchObject({ status: "no_data" });
  });

  it("flags rhythm & recovery as needing attention when sleep is irregular", () => {
    const result = buildHealthDomains({
      sleepSummary: {
        lastNightMinutes: 200,
        averageMinutes: 300,
        nightsInWindow: 5,
        consistency: "irregular",
        trend: "down",
      },
    });
    const rhythm = result.find((d) => d.key === "rhythm_recovery");
    expect(rhythm?.status).toBe("attention");
    expect(rhythm?.narrative).toContain("irregular");
  });

  it("ignores an empty sleep summary (nightsInWindow 0)", () => {
    const result = buildHealthDomains({
      sleepSummary: {
        lastNightMinutes: null,
        averageMinutes: null,
        nightsInWindow: 0,
        consistency: "unknown",
        trend: "unknown",
      },
    });
    const rhythm = result.find((d) => d.key === "rhythm_recovery");
    expect(rhythm).toMatchObject({ status: "no_data", narrative: "Nothing logged here yet." });
  });

  it("keeps reproductive as no_data unless the viewer is explicitly the patient themself", () => {
    const withoutFlag = buildHealthDomains({});
    expect(withoutFlag.find((d) => d.key === "reproductive")).toMatchObject({ status: "no_data" });

    const asSupporter = buildHealthDomains({ canViewReproductive: false });
    expect(asSupporter.find((d) => d.key === "reproductive")).toMatchObject({ status: "no_data" });
  });
});
