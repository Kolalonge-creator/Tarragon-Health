import { describe, expect, it } from "@jest/globals";
import {
  FERTILE_WINDOW_DISCLAIMER,
  NOT_CONTRACEPTION_LABEL,
  predictCycle,
  withoutFertilityEstimate,
  type CyclePredictionInput,
} from "./prediction";
import {
  EXPORT_NOT_CONTRACEPTION_FOOTER,
  describeFertileWindow,
  hasNotContraceptionLabel,
  mentionsFertility,
} from "./planning-copy";

/**
 * Golden cases for the single cycle engine (S66). Web and mobile used to carry two copies; both now import this one, so these dates are
 * the answer on every surface. Computed by hand from the rules in prediction.ts (luteal 14 days counted back from the predicted next
 * period; fertile window = 5 days before ovulation to 1 day after).
 */
const REGULAR: CyclePredictionInput = {
  periods: [
    { startDate: "2026-06-01", endDate: "2026-06-05" },
    { startDate: "2026-06-29", endDate: "2026-07-03" },
    { startDate: "2026-07-27", endDate: "2026-07-31" },
    { startDate: "2026-08-24", endDate: "2026-08-28" },
  ],
  today: "2026-09-02",
  lifeStage: "menstruating",
};

describe("golden: a regular 28 day history", () => {
  it("planning mode ON gives the exact window", () => {
    const p = predictCycle({ ...REGULAR, conceptionPlanning: true });
    expect(p.predictedNextPeriodDate).toBe("2026-09-21");
    expect(p.predictedOvulationDate).toBe("2026-09-07");
    expect(p.fertileWindowStart).toBe("2026-09-02");
    expect(p.fertileWindowEnd).toBe("2026-09-08");
    expect(p.currentPhase).toBe("fertile");
    expect(p.currentCycleDay).toBe(10);
  });

  it("planning mode OFF (the default) carries no ovulation date, no window and no fertile phase, and everything else is identical", () => {
    const on = predictCycle({ ...REGULAR, conceptionPlanning: true });
    const off = predictCycle(REGULAR);
    expect(off.predictedOvulationDate).toBeNull();
    expect(off.fertileWindowStart).toBeNull();
    expect(off.fertileWindowEnd).toBeNull();
    expect(off.currentPhase).toBe("follicular");
    expect({ ...off, predictedOvulationDate: on.predictedOvulationDate, fertileWindowStart: on.fertileWindowStart, fertileWindowEnd: on.fertileWindowEnd, currentPhase: on.currentPhase }).toEqual(on);
    expect(predictCycle({ ...REGULAR, conceptionPlanning: false })).toEqual(off);
  });

  it("OFF maps the ovulation day and the days after it to the neutral neighbour phases", () => {
    expect(predictCycle({ ...REGULAR, today: "2026-09-07" }).currentPhase).toBe("follicular");
    expect(predictCycle({ ...REGULAR, today: "2026-09-08" }).currentPhase).toBe("luteal");
    expect(predictCycle({ ...REGULAR, today: "2026-09-07", conceptionPlanning: true }).currentPhase).toBe("ovulation");
  });

  it("never produces a fertile or ovulation phase on any day of a long run while OFF", () => {
    const phases = new Set<string>();
    for (let d = 0; d < 60; d += 1) {
      const day = new Date(Date.parse("2026-08-24T00:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);
      phases.add(predictCycle({ ...REGULAR, today: day }).currentPhase);
    }
    expect(phases.has("fertile")).toBe(false);
    expect(phases.has("ovulation")).toBe(false);
  });
});

describe("golden: an irregular history", () => {
  const IRREGULAR: CyclePredictionInput = {
    periods: [
      { startDate: "2026-03-01", endDate: null },
      { startDate: "2026-04-12", endDate: null },
      { startDate: "2026-05-05", endDate: null },
      { startDate: "2026-06-30", endDate: null },
    ],
    today: "2026-07-10",
    lifeStage: "menstruating",
  };
  it("keeps the same next-period estimate with the mode on or off, and reports irregular", () => {
    const off = predictCycle(IRREGULAR);
    const on = predictCycle({ ...IRREGULAR, conceptionPlanning: true });
    expect(off.stats.cycleLengths).toEqual([42, 23, 56]);
    expect(off.stats.regularity).toBe("irregular");
    expect(off.predictedNextPeriodDate).toBe(on.predictedNextPeriodDate);
    expect(off.fertileWindowStart).toBeNull();
    expect(on.fertileWindowStart).not.toBeNull();
  });
});

describe("golden: no history", () => {
  it("returns an empty, window-free prediction in both modes", () => {
    for (const conceptionPlanning of [true, false]) {
      const p = predictCycle({ periods: [], today: "2026-09-02", lifeStage: "menstruating", conceptionPlanning });
      expect(p.fertileWindowStart).toBeNull();
      expect(p.currentPhase).toBe("unknown");
    }
  });
});

describe("withoutFertilityEstimate", () => {
  it("is idempotent", () => {
    const p = predictCycle({ ...REGULAR, conceptionPlanning: true });
    expect(withoutFertilityEstimate(withoutFertilityEstimate(p))).toEqual(withoutFertilityEstimate(p));
  });
});

describe("not-contraception label (acceptance test, S66 A14)", () => {
  it("the disclaimer carries the exact label and says estimate", () => {
    expect(FERTILE_WINDOW_DISCLAIMER.startsWith(NOT_CONTRACEPTION_LABEL)).toBe(true);
    expect(FERTILE_WINDOW_DISCLAIMER.toLowerCase()).toContain("estimate");
  });
  it("any line built to state a window carries the label, and no window means no line", () => {
    const p = predictCycle({ ...REGULAR, conceptionPlanning: true });
    const line = describeFertileWindow(p, (d) => d);
    expect(line).not.toBeNull();
    expect(hasNotContraceptionLabel(line as string)).toBe(true);
    expect(describeFertileWindow(predictCycle(REGULAR), (d) => d)).toBeNull();
  });
  it("the export footer carries the label", () => {
    expect(hasNotContraceptionLabel(EXPORT_NOT_CONTRACEPTION_FOOTER)).toBe(true);
  });
  it("copy never suggests avoiding a pregnancy", () => {
    const all = [FERTILE_WINDOW_DISCLAIMER, EXPORT_NOT_CONTRACEPTION_FOOTER.replace("must not be used to avoid or to plan around a pregnancy", "")];
    for (const text of all) {
      expect(/safe days?|avoid(ing)? (a )?pregnan|prevent(ing)? (a )?pregnan(?!cy and)|natural family planning|birth control/i.test(text.replace("It cannot prevent a pregnancy", ""))).toBe(false);
    }
  });
  it("mentionsFertility flags the words the notification lint must keep out", () => {
    expect(mentionsFertility("Your fertile window starts tomorrow")).toBe(true);
    expect(mentionsFertility("Ovulation day")).toBe(true);
    expect(mentionsFertility("Your tracker has an update")).toBe(false);
  });
});
