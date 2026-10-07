import { FERTILE_WINDOW_BANNED_PHRASES } from "@tarragon/i18n";
import { addDays, predictCycle, type CyclePhase, type CyclePrediction } from "./cycle-prediction";
import {
  applyPlanningMode,
  isPlanningMode,
  phaseDescription,
  phaseLabel,
} from "./cycle-fertile-mode";

// S85 D2 / OQ-12 on the phone: the fertile window is hidden unless "Planning a pregnancy" is on.

const START = "2026-03-01";

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

const DAYS = [1, 3, 7, 10, 14, 15, 20, 26];

describe("phone: Planning a pregnancy mode", () => {
  it("is off unless a real true", () => {
    expect(isPlanningMode(true)).toBe(true);
    for (const v of [false, null, undefined]) expect(isPlanningMode(v)).toBe(false);
  });

  it("sanity: the engine reaches every phase on these days", () => {
    const phases = new Set(DAYS.map((d) => predictionAt(d).currentPhase));
    for (const p of ["menstrual", "follicular", "fertile", "ovulation", "luteal"] as CyclePhase[]) {
      expect(phases.has(p)).toBe(true);
    }
  });

  it("off: no ovulation date, no window, no phase that names or implies one", () => {
    for (const d of DAYS) {
      const shown = applyPlanningMode(predictionAt(d), false);
      expect(shown.predictedOvulationDate).toBeNull();
      expect(shown.fertileWindowStart).toBeNull();
      expect(shown.fertileWindowEnd).toBeNull();
      expect(["fertile", "ovulation", "luteal"]).not.toContain(shown.currentPhase);
    }
  });

  it("off: period prediction is untouched", () => {
    for (const d of DAYS) {
      const raw = predictionAt(d);
      const shown = applyPlanningMode(raw, false);
      expect(shown.predictedNextPeriodDate).toBe(raw.predictedNextPeriodDate);
      expect(shown.predictedNextPeriodEarliest).toBe(raw.predictedNextPeriodEarliest);
      expect(shown.predictedNextPeriodLatest).toBe(raw.predictedNextPeriodLatest);
      expect(shown.currentCycleDay).toBe(raw.currentCycleDay);
    }
  });

  it("on: unchanged", () => {
    const raw = predictionAt(14);
    expect(applyPlanningMode(raw, true)).toBe(raw);
    expect(raw.fertileWindowStart).not.toBeNull();
  });

  it("off: the words never say fertile, ovulation or luteal, or a banned phrase", () => {
    for (const d of DAYS) {
      const phase = applyPlanningMode(predictionAt(d), false).currentPhase;
      const text = `${phaseLabel(phase, false)} ${phaseDescription(phase, false)}`.toLowerCase();
      expect(text).not.toMatch(/fertile|ovulat|luteal|egg|conceive/);
      for (const banned of FERTILE_WINDOW_BANNED_PHRASES) expect(text).not.toContain(banned);
    }
  });
});
