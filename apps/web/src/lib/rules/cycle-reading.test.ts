import {
  ALL_CYCLE_READING_CODES,
  suggestCycleReading,
  IRREGULAR_CYCLES_READING,
} from "./cycle-reading";

describe("suggestCycleReading", () => {
  it("offers fertility reading during the fertile window", () => {
    const reading = suggestCycleReading({
      phase: "fertile",
      lifeStage: "menstruating",
      isIrregular: false,
    });
    expect(reading[0].code).toBe("women-fertility-basics");
  });

  it("lets life stage win over cycle phase", () => {
    // A pregnant patient must not be told about her luteal phase.
    const reading = suggestCycleReading({
      phase: "luteal",
      lifeStage: "pregnant",
      isIrregular: false,
    });
    expect(reading).toHaveLength(1);
    expect(reading[0].code).toBe("women-pregnancy-warning-signs");
  });

  it("surfaces the irregular-periods article when cycles vary", () => {
    const reading = suggestCycleReading({
      phase: "luteal",
      lifeStage: "menstruating",
      isIrregular: true,
    });
    expect(reading.map((r) => r.code)).toContain(IRREGULAR_CYCLES_READING.code);
  });

  it("pairs irregular cycles with preconception reading when trying to conceive", () => {
    // The one case where both matter: irregular cycles are directly relevant
    // to somebody trying to conceive.
    const reading = suggestCycleReading({
      phase: "follicular",
      lifeStage: "trying_to_conceive",
      isIrregular: true,
    });
    expect(reading.map((r) => r.code)).toEqual([
      "women-preconception-health",
      "women-irregular-periods",
    ]);
  });

  it("never returns more than two suggestions", () => {
    for (const phase of ["menstrual", "follicular", "fertile", "ovulation", "luteal"] as const) {
      expect(
        suggestCycleReading({ phase, lifeStage: "menstruating", isIrregular: true }).length
      ).toBeLessThanOrEqual(2);
    }
  });

  it("never repeats the same article twice", () => {
    const reading = suggestCycleReading({
      phase: "menstrual",
      lifeStage: "menstruating",
      isIrregular: true,
    });
    expect(new Set(reading.map((r) => r.code)).size).toBe(reading.length);
  });

  it("says nothing when there is no cycle position and no life stage to go on", () => {
    expect(
      suggestCycleReading({
        phase: "unknown",
        lifeStage: "not_applicable",
        isIrregular: false,
      })
    ).toEqual([]);
  });

  it("only references codes that exist in the live catalogue", () => {
    // Snapshot of health_education_content.code taken from the live project
    // on 2026-09-02. If an article is renamed or retired, this fails here
    // rather than rendering a dead link on a patient's cycle page.
    const liveCodes = new Set([
      "women-bone-health-menopause",
      "women-breastfeeding-basics",
      "women-contraception-options",
      "women-fertility-basics",
      "women-fibroids-explained",
      "women-irregular-periods",
      "women-menopause-symptom-management",
      "women-menopause-what-to-expect",
      "women-menstrual-cycle",
      "women-pcos-explained",
      "women-pelvic-pain-causes",
      "women-postpartum-recovery",
      "women-preconception-health",
      "women-pregnancy-first-trimester",
      "women-pregnancy-warning-signs",
      "women-vaginal-health",
    ]);
    const missing = ALL_CYCLE_READING_CODES.filter((code) => !liveCodes.has(code));
    expect(missing).toEqual([]);
  });
});
