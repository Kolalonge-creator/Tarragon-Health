import { describe, expect, it } from "@jest/globals";
import { computeCycleNudges } from "./cycle-nudges";

describe("computeCycleNudges", () => {
  // The next-period estimate this file used to produce has moved to
  // cycle-prediction.ts, which works from observed period history instead of
  // a self-reported average. What is asserted here is that it did not stay
  // behind as well: two estimates would eventually contradict each other.
  it("points at the cycle tracker instead of estimating the next period itself", () => {
    const nudges = computeCycleNudges({
      lifeStage: "menstruating",
      lastPeriodDate: "2026-07-01",
      averageCycleLengthDays: 28,
    });
    expect(nudges).toHaveLength(1);
    expect(nudges[0]?.id).toBe("open_cycle_tracker");
    expect(nudges.map((nudge) => nudge.id)).not.toContain("next_period_estimate");
  });

  it("gives the same nudge whether or not an average cycle length is recorded", () => {
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

  // Deliberately unconditional now. The old estimate needed a last-period
  // date to compute anything, so it stayed silent without one; the tracker
  // link is most useful to exactly that person, who has nothing logged yet.
  it("still points at the tracker when no last period date is on file", () => {
    const nudges = computeCycleNudges({
      lifeStage: "menstruating",
      lastPeriodDate: null,
      averageCycleLengthDays: 28,
    });
    expect(nudges.map((nudge) => nudge.id)).toEqual(["open_cycle_tracker"]);
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
