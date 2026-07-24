import { describe, expect, it } from "@jest/globals";
import { computeCycleNudges } from "./cycle-nudges";

describe("computeCycleNudges", () => {
  it("estimates the next period from the last period date and average cycle length", () => {
    const nudges = computeCycleNudges({
      lifeStage: "menstruating",
      lastPeriodDate: "2026-07-01",
      averageCycleLengthDays: 28,
    });
    expect(nudges).toHaveLength(1);
    expect(nudges[0]?.id).toBe("next_period_estimate");
    expect(nudges[0]?.label).toContain("not a prediction");
  });

  it("defaults to a 28-day cycle when none is recorded", () => {
    const withDefault = computeCycleNudges({
      lifeStage: "menstruating",
      lastPeriodDate: "2026-07-01",
      averageCycleLengthDays: null,
    });
    const withExplicit = computeCycleNudges({
      lifeStage: "menstruating",
      lastPeriodDate: "2026-07-01",
      averageCycleLengthDays: 28,
    });
    expect(withDefault[0]?.label).toBe(withExplicit[0]?.label);
  });

  it("gives no next-period nudge when no last period date is on file", () => {
    const nudges = computeCycleNudges({
      lifeStage: "menstruating",
      lastPeriodDate: null,
      averageCycleLengthDays: 28,
    });
    expect(nudges).toHaveLength(0);
  });

  it("suggests antenatal booking when pregnant", () => {
    const nudges = computeCycleNudges({
      lifeStage: "pregnant",
      lastPeriodDate: null,
      averageCycleLengthDays: null,
    });
    expect(nudges.map((n) => n.id)).toEqual(["antenatal_booking"]);
  });

  it("suggests a care-team conversation for perimenopause and menopause", () => {
    const peri = computeCycleNudges({
      lifeStage: "perimenopausal",
      lastPeriodDate: null,
      averageCycleLengthDays: null,
    });
    const meno = computeCycleNudges({
      lifeStage: "menopausal",
      lastPeriodDate: null,
      averageCycleLengthDays: null,
    });
    expect(peri.map((n) => n.id)).toEqual(["menopause_checkin"]);
    expect(meno.map((n) => n.id)).toEqual(["menopause_checkin"]);
  });

  it("gives no nudges when not applicable", () => {
    const nudges = computeCycleNudges({
      lifeStage: "not_applicable",
      lastPeriodDate: null,
      averageCycleLengthDays: null,
    });
    expect(nudges).toHaveLength(0);
  });
});
