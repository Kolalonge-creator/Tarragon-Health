import { describe, expect, it } from "@jest/globals";
import { bre01Pace, cueSchedule, stateAt } from "@tarragon/shared";
import { dueCues, pacerScale, phaseKey, shouldAnnounce, steppedScale } from "./breathing-view";

const { pace } = bre01Pace("standard");

describe("breathing view", () => {
  it("keeps the guide visible and inside its range", () => {
    expect(pacerScale(0)).toBeCloseTo(0.55);
    expect(pacerScale(1)).toBeCloseTo(1);
    expect(pacerScale(-3)).toBeCloseTo(0.55);
    expect(pacerScale(9)).toBeCloseTo(1);
  });

  it("steps between two sizes when motion is reduced", () => {
    expect(steppedScale("in")).toBe(1);
    expect(steppedScale("out")).toBe(0.55);
  });

  it("names the phase in the catalogue", () => {
    expect(phaseKey("in")).toBe("breathing.in");
    expect(phaseKey("out")).toBe("breathing.out");
  });

  it("announces at the start and on each phase change only", () => {
    const s0 = stateAt(pace, 0);
    expect(shouldAnnounce(null, s0)).toBe(true);
    expect(shouldAnnounce(s0, stateAt(pace, 1000))).toBe(false);
    expect(shouldAnnounce(stateAt(pace, 3900), stateAt(pace, 4000))).toBe(true);
    expect(shouldAnnounce(stateAt(pace, 9900), stateAt(pace, 10_000))).toBe(true);
    expect(shouldAnnounce(stateAt(pace, 100_000), stateAt(pace, 180_000))).toBe(false);
  });

  it("fires each cue once as time moves forward", () => {
    const cues = cueSchedule(pace);
    expect(dueCues(cues, null, 0)).toEqual([{ atMs: 0, phase: "in" }]);
    expect(dueCues(cues, 0, 3999)).toEqual([]);
    expect(dueCues(cues, 3999, 4100)).toEqual([{ atMs: 4000, phase: "out" }]);
    const all = dueCues(cues, null, 999_999);
    expect(all).toHaveLength(36);
    // two adjacent ticks never double-fire the same cue
    expect(dueCues(cues, 4000, 4100)).toEqual([]);
  });
});
