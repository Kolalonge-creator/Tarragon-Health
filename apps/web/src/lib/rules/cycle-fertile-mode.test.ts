import { FERTILE_WINDOW_BANNED_PHRASES } from "@tarragon/i18n";
import {
  addDays,
  predictCycle,
  PHASE_DESCRIPTION,
  PHASE_LABEL,
  type CyclePhase,
  type CyclePrediction,
} from "./cycle-prediction";
import {
  applyPlanningMode,
  insightPhasePhrase,
  isPlanningMode,
  phaseDescription,
  phaseLabel,
  phaseVisible,
} from "./cycle-fertile-mode";

const START = "2026-03-01";

/** Four cycles of exactly 28 days, then `daysIntoCycle` days into the next one. */
function predictionAt(daysIntoCycle: number): CyclePrediction {
  const starts = [0, 28, 56, 84].map((n) => addDays(START, n));
  return predictCycle({
    periods: starts.map((startDate) => ({ startDate, endDate: addDays(startDate, 4) })),
    today: addDays(starts[3], daysIntoCycle),
    lifeStage: "menstruating",
    selfReportedCycleLengthDays: null,
    heavyFlowDates: [],
  });
}

describe("Planning a pregnancy mode defaults to off (S85 D2)", () => {
  it("only a real true turns it on", () => {
    expect(isPlanningMode(true)).toBe(true);
    for (const v of [false, null, undefined]) expect(isPlanningMode(v)).toBe(false);
  });
});

describe("applyPlanningMode", () => {
  // Day 14 of a 28 day cycle is ovulation; days 9 to 15 are the window; day 20 is luteal.
  const days = [1, 3, 7, 10, 14, 15, 20, 26];

  it("sanity: the engine really reaches fertile, ovulation and luteal on these days", () => {
    const phases = new Set(days.map((d) => predictionAt(d).currentPhase));
    for (const phase of ["menstrual", "follicular", "fertile", "ovulation", "luteal"] as CyclePhase[]) {
      expect(phases.has(phase)).toBe(true);
    }
  });

  it("off: no ovulation date, no window, and no phase that names or implies one, on any day", () => {
    for (const d of days) {
      const shown = applyPlanningMode(predictionAt(d), false);
      expect(shown.predictedOvulationDate).toBeNull();
      expect(shown.fertileWindowStart).toBeNull();
      expect(shown.fertileWindowEnd).toBeNull();
      expect(["fertile", "ovulation", "luteal"]).not.toContain(shown.currentPhase);
    }
  });

  it("off: period prediction is untouched", () => {
    for (const d of days) {
      const raw = predictionAt(d);
      const shown = applyPlanningMode(raw, false);
      expect(shown.predictedNextPeriodDate).toBe(raw.predictedNextPeriodDate);
      expect(shown.predictedNextPeriodEarliest).toBe(raw.predictedNextPeriodEarliest);
      expect(shown.predictedNextPeriodLatest).toBe(raw.predictedNextPeriodLatest);
      expect(shown.currentCycleDay).toBe(raw.currentCycleDay);
      expect(shown.daysUntilNextPeriod).toBe(raw.daysUntilNextPeriod);
      expect(shown.confidence).toBe(raw.confidence);
      expect(shown.flags).toEqual(raw.flags);
    }
  });

  it("off: a period day stays a period day", () => {
    expect(applyPlanningMode(predictionAt(2), false).currentPhase).toBe("menstrual");
  });

  it("on: the prediction is returned as is", () => {
    for (const d of days) {
      const raw = predictionAt(d);
      expect(applyPlanningMode(raw, true)).toBe(raw);
      expect(raw.fertileWindowStart).not.toBeNull();
    }
  });
});

describe("words for the current phase", () => {
  it("off: never says fertile, ovulation or luteal, and never a banned phrase", () => {
    for (const d of [1, 3, 7, 10, 14, 15, 20, 26]) {
      const phase = applyPlanningMode(predictionAt(d), false).currentPhase;
      const text = `${phaseLabel(phase, false)} ${phaseDescription(phase, false)}`.toLowerCase();
      expect(text).not.toMatch(/fertile|ovulat|luteal|egg|conceive/);
      for (const banned of FERTILE_WINDOW_BANNED_PHRASES) expect(text).not.toContain(banned);
    }
  });

  it("on: the usual wording", () => {
    expect(phaseLabel("fertile", true)).toBe(PHASE_LABEL.fertile);
    expect(phaseDescription("ovulation", true)).toBe(PHASE_DESCRIPTION.ovulation);
  });

  it("phaseVisible hides exactly the window phases while off", () => {
    expect(phaseVisible("fertile", false)).toBe(false);
    expect(phaseVisible("ovulation", false)).toBe(false);
    expect(phaseVisible("luteal", false)).toBe(false);
    expect(phaseVisible("menstrual", false)).toBe(true);
    expect(phaseVisible("follicular", false)).toBe(true);
    expect(phaseVisible("fertile", true)).toBe(true);
  });

  it("pattern wording off never names a hidden phase", () => {
    for (const phase of ["menstrual", "follicular", "fertile", "ovulation", "luteal", "unknown"] as CyclePhase[]) {
      expect(insightPhasePhrase(phase, false).toLowerCase()).not.toMatch(/fertile|ovulat|luteal/);
    }
    expect(insightPhasePhrase("fertile", true)).toBe("Usually in your fertile window.");
  });
});
