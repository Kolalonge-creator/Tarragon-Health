import {
  addDays,
  nextPeriodSummary,
  daysBetween,
  predictCycle,
  FERTILE_DAYS_BEFORE_OVULATION,
  LUTEAL_PHASE_DAYS,
  NORMAL_PERIOD_MAX_DAYS,
  type CyclePredictionInput,
  type ObservedPeriod,
} from "./cycle-prediction";

/** Builds a run of perfectly regular periods ending at `lastStart`. */
function regularPeriods(
  lastStart: string,
  count: number,
  cycleLength: number,
  durationDays = 5
): ObservedPeriod[] {
  const periods: ObservedPeriod[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const startDate = addDays(lastStart, -cycleLength * index);
    periods.push({ startDate, endDate: addDays(startDate, durationDays - 1) });
  }
  return periods;
}

function input(overrides: Partial<CyclePredictionInput> = {}): CyclePredictionInput {
  return {
    periods: [],
    today: "2026-09-02",
    lifeStage: "menstruating",
    ...overrides,
  };
}

describe("date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("adds days across a leap day", () => {
    expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
  });

  it("counts days between dates in both directions", () => {
    expect(daysBetween("2026-09-01", "2026-09-30")).toBe(29);
    expect(daysBetween("2026-09-30", "2026-09-01")).toBe(-29);
  });
});

describe("predictCycle with no history", () => {
  it("returns nulls and no confidence rather than guessing", () => {
    const result = predictCycle(input());
    expect(result.confidence).toBe("none");
    expect(result.predictedNextPeriodDate).toBeNull();
    expect(result.predictedOvulationDate).toBeNull();
    expect(result.currentPhase).toBe("unknown");
    expect(result.stats.observedCycles).toBe(0);
  });

  it("falls back to the self-reported average for a single logged period", () => {
    const result = predictCycle(
      input({
        periods: [{ startDate: "2026-08-20", endDate: "2026-08-24" }],
        selfReportedCycleLengthDays: 30,
      })
    );
    expect(result.expectedCycleLengthDays).toBe(30);
    expect(result.predictedNextPeriodDate).toBe("2026-09-19");
    // One period is not one cycle, so confidence stays at the floor.
    expect(result.confidence).toBe("none");
  });

  it("falls back to 28 days only when nothing at all is known", () => {
    const result = predictCycle(
      input({ periods: [{ startDate: "2026-08-20", endDate: null }] })
    );
    expect(result.expectedCycleLengthDays).toBe(28);
    expect(result.predictedNextPeriodDate).toBe("2026-09-17");
  });

  it("ignores an implausible self-reported average", () => {
    const result = predictCycle(
      input({
        periods: [{ startDate: "2026-08-20", endDate: null }],
        selfReportedCycleLengthDays: 200,
      })
    );
    expect(result.expectedCycleLengthDays).toBe(28);
  });
});

describe("predictCycle prediction from observed history", () => {
  it("uses the patient's own cycles over their self-reported average", () => {
    const result = predictCycle(
      input({
        periods: regularPeriods("2026-08-20", 6, 31),
        selfReportedCycleLengthDays: 28,
        today: "2026-09-02",
      })
    );
    expect(result.expectedCycleLengthDays).toBe(31);
    expect(result.predictedNextPeriodDate).toBe("2026-09-20");
  });

  it("reaches high confidence with six consistent cycles", () => {
    const result = predictCycle(
      input({ periods: regularPeriods("2026-08-20", 7, 28) })
    );
    expect(result.stats.usedCycles).toBe(6);
    expect(result.stats.regularity).toBe("regular");
    expect(result.confidence).toBe("high");
  });

  it("stays at medium confidence with three to five cycles", () => {
    const result = predictCycle(
      input({ periods: regularPeriods("2026-08-20", 4, 28) })
    );
    expect(result.stats.usedCycles).toBe(3);
    expect(result.confidence).toBe("medium");
  });

  it("stays at low confidence with only one or two cycles", () => {
    const result = predictCycle(
      input({ periods: regularPeriods("2026-08-20", 3, 28) })
    );
    expect(result.stats.usedCycles).toBe(2);
    expect(result.confidence).toBe("low");
  });

  it("only considers the six most recent cycles", () => {
    // Twelve old 35-day cycles followed by six recent 27-day ones: the
    // recent run should win outright, not be averaged with the old.
    const old = regularPeriods("2026-01-01", 12, 35);
    const recent = regularPeriods("2026-08-20", 7, 27).slice(1);
    const result = predictCycle(input({ periods: [...old, ...recent] }));
    expect(result.stats.usedCycles).toBe(6);
    expect(result.expectedCycleLengthDays).toBe(27);
  });

  it("weights recent cycles more heavily than older ones", () => {
    // Three 26-day cycles then three 32-day ones. A plain mean would give
    // 29; recency weighting should land above that.
    const periods: ObservedPeriod[] = [{ startDate: "2026-01-01", endDate: "2026-01-05" }];
    for (const length of [26, 26, 26, 32, 32, 32]) {
      const previous = periods[periods.length - 1].startDate;
      const startDate = addDays(previous, length);
      periods.push({ startDate, endDate: addDays(startDate, 4) });
    }
    const result = predictCycle(input({ periods, today: "2026-08-01" }));
    expect(result.stats.averageCycleLengthDays).toBeGreaterThan(29);
  });
});

describe("predictCycle handles gaps and bad data", () => {
  it("excludes an implausibly long gap from the average", () => {
    // A patient logs regularly, stops for eight months, then resumes.
    const before = regularPeriods("2026-01-10", 4, 28);
    const after = regularPeriods("2026-08-20", 3, 28).slice(1);
    const result = predictCycle(input({ periods: [...before, ...after] }));
    // The ~220-day gap must not become a "cycle".
    expect(result.stats.cycleLengths.every((length) => length <= 90)).toBe(true);
    expect(result.expectedCycleLengthDays).toBe(28);
  });

  it("trims a single outlier cycle instead of letting it drag the average", () => {
    const periods: ObservedPeriod[] = [{ startDate: "2026-01-01", endDate: "2026-01-05" }];
    for (const length of [28, 28, 28, 28, 55, 28]) {
      const previous = periods[periods.length - 1].startDate;
      const startDate = addDays(previous, length);
      periods.push({ startDate, endDate: addDays(startDate, 4) });
    }
    const result = predictCycle(input({ periods, today: "2026-09-01" }));
    // Without trimming the mean would be ~32.5; the outlier is dropped.
    expect(result.expectedCycleLengthDays).toBe(28);
  });

  it("de-duplicates a double-logged period and prefers the row with an end date", () => {
    const result = predictCycle(
      input({
        periods: [
          { startDate: "2026-08-20", endDate: null },
          { startDate: "2026-08-20", endDate: "2026-08-25" },
          { startDate: "2026-07-23", endDate: "2026-07-27" },
        ],
      })
    );
    expect(result.stats.observedCycles).toBe(1);
    expect(result.stats.averagePeriodDurationDays).toBe(5.5);
  });

  it("ignores malformed dates and an end date before its start", () => {
    const result = predictCycle(
      input({
        periods: [
          { startDate: "not-a-date", endDate: null },
          { startDate: "2026-08-20", endDate: "2026-08-10" },
        ],
      })
    );
    expect(result.lastPeriodStartDate).toBe("2026-08-20");
    expect(result.stats.averagePeriodDurationDays).toBeNull();
  });

  it("accepts periods supplied in any order", () => {
    const shuffled = [
      { startDate: "2026-07-23", endDate: "2026-07-27" },
      { startDate: "2026-08-20", endDate: "2026-08-24" },
      { startDate: "2026-06-25", endDate: "2026-06-29" },
    ];
    const result = predictCycle(input({ periods: shuffled }));
    expect(result.lastPeriodStartDate).toBe("2026-08-20");
    expect(result.stats.cycleLengths).toEqual([28, 28]);
  });

  it("returns a null cycle day when today precedes the last logged period", () => {
    const result = predictCycle(
      input({ periods: regularPeriods("2026-10-20", 3, 28), today: "2026-09-02" })
    );
    expect(result.currentCycleDay).toBeNull();
    expect(result.currentPhase).toBe("unknown");
  });
});

describe("ovulation and fertile window", () => {
  it("counts ovulation back from the next period, not forward from the last", () => {
    // The key correctness case. For a 35-day cycle, midpoint reasoning says
    // day 18; luteal-phase counting says day 21.
    const result = predictCycle(
      input({ periods: regularPeriods("2026-08-01", 4, 35), today: "2026-08-10" })
    );
    expect(result.predictedNextPeriodDate).toBe("2026-09-05");
    expect(result.predictedOvulationDate).toBe("2026-08-22");
    expect(daysBetween("2026-08-01", "2026-08-22") + 1).toBe(22);
  });

  it("places ovulation a fixed luteal phase before the next period", () => {
    for (const cycleLength of [26, 28, 30, 33, 38]) {
      const result = predictCycle(
        input({ periods: regularPeriods("2026-08-01", 4, cycleLength) })
      );
      expect(
        daysBetween(
          result.predictedOvulationDate as string,
          result.predictedNextPeriodDate as string
        )
      ).toBe(LUTEAL_PHASE_DAYS);
    }
  });

  it("shortens the luteal phase for very short cycles so ovulation never lands in the period", () => {
    const result = predictCycle(
      input({ periods: regularPeriods("2026-08-01", 4, 21, 4) })
    );
    const ovulationDay = daysBetween("2026-08-01", result.predictedOvulationDate as string) + 1;
    expect(ovulationDay).toBeGreaterThanOrEqual(8);
    expect(result.predictedOvulationDate).toBe("2026-08-11");
  });

  it("spans six days ending the day after ovulation", () => {
    const result = predictCycle(input({ periods: regularPeriods("2026-08-01", 4, 28) }));
    const start = result.fertileWindowStart as string;
    const end = result.fertileWindowEnd as string;
    expect(daysBetween(start, result.predictedOvulationDate as string)).toBe(
      FERTILE_DAYS_BEFORE_OVULATION
    );
    expect(daysBetween(start, end)).toBe(6);
  });
});

describe("current phase", () => {
  const periods = regularPeriods("2026-08-01", 5, 28, 5);

  it("is menstrual during the logged bleeding days", () => {
    expect(predictCycle(input({ periods, today: "2026-08-01" })).currentPhase).toBe("menstrual");
    expect(predictCycle(input({ periods, today: "2026-08-05" })).currentPhase).toBe("menstrual");
  });

  it("is follicular after bleeding and before the fertile window", () => {
    expect(predictCycle(input({ periods, today: "2026-08-08" })).currentPhase).toBe("follicular");
  });

  it("is fertile in the run-up to ovulation and ovulation on the day itself", () => {
    // 28-day cycle from 2026-08-01: next period 2026-08-29, ovulation 08-15.
    expect(predictCycle(input({ periods, today: "2026-08-11" })).currentPhase).toBe("fertile");
    expect(predictCycle(input({ periods, today: "2026-08-15" })).currentPhase).toBe("ovulation");
  });

  it("is luteal after the fertile window closes", () => {
    expect(predictCycle(input({ periods, today: "2026-08-20" })).currentPhase).toBe("luteal");
  });

  it("uses the recorded end date rather than the average when one exists", () => {
    const longPeriod = [
      { startDate: "2026-07-04", endDate: "2026-07-08" },
      { startDate: "2026-08-01", endDate: "2026-08-07" },
    ];
    expect(predictCycle(input({ periods: longPeriod, today: "2026-08-07" })).currentPhase).toBe(
      "menstrual"
    );
  });
});

describe("overdue handling", () => {
  const periods = regularPeriods("2026-08-01", 6, 28);

  it("is not overdue merely because the point estimate has passed", () => {
    // Point estimate 2026-08-29 with a perfectly regular history still has a
    // one-day band, so the day after is inside the window.
    const result = predictCycle(input({ periods, today: "2026-08-30" }));
    expect(result.predictedNextPeriodDate).toBe("2026-08-29");
    expect(result.isOverdue).toBe(false);
  });

  it("reports overdue with a day count once the whole window has passed", () => {
    const result = predictCycle(input({ periods, today: "2026-09-05" }));
    expect(result.isOverdue).toBe(true);
    expect(result.daysOverdue).toBe(7);
  });

  it("counts down to the next period before it is due", () => {
    const result = predictCycle(input({ periods, today: "2026-08-24" }));
    expect(result.daysUntilNextPeriod).toBe(5);
  });

  it("widens the window when cycles are variable", () => {
    const variable: ObservedPeriod[] = [{ startDate: "2026-01-01", endDate: "2026-01-05" }];
    for (const length of [24, 35, 26, 38, 28, 33]) {
      const previous = variable[variable.length - 1].startDate;
      const startDate = addDays(previous, length);
      variable.push({ startDate, endDate: addDays(startDate, 4) });
    }
    const result = predictCycle(input({ periods: variable, today: "2026-07-01" }));
    const bandDays = daysBetween(
      result.predictedNextPeriodEarliest as string,
      result.predictedNextPeriodLatest as string
    );
    expect(bandDays).toBeGreaterThan(4);
    expect(result.confidence).toBe("low");
  });
});

describe("clinical flags", () => {
  function flagIds(result: ReturnType<typeof predictCycle>) {
    return result.flags.map((flag) => flag.id);
  }

  it("raises an urgent flag for bleeding logged after menopause", () => {
    const result = predictCycle(
      input({
        periods: [{ startDate: "2026-08-20", endDate: "2026-08-23" }],
        lifeStage: "menopausal",
      })
    );
    expect(flagIds(result)).toContain("postmenopausal_bleeding");
    expect(result.flags.find((flag) => flag.id === "postmenopausal_bleeding")?.severity).toBe(
      "urgent"
    );
  });

  it("does not raise postmenopausal bleeding for somebody still menstruating", () => {
    const result = predictCycle(
      input({ periods: [{ startDate: "2026-08-20", endDate: "2026-08-23" }] })
    );
    expect(flagIds(result)).not.toContain("postmenopausal_bleeding");
  });

  it("flags 90 days without a period", () => {
    const result = predictCycle(
      input({ periods: [{ startDate: "2026-06-01", endDate: "2026-06-05" }], today: "2026-09-02" })
    );
    expect(flagIds(result)).toContain("amenorrhoea");
  });

  it("does not flag amenorrhoea just before the 90-day mark", () => {
    const result = predictCycle(
      input({ periods: [{ startDate: "2026-06-06", endDate: "2026-06-10" }], today: "2026-09-02" })
    );
    expect(flagIds(result)).not.toContain("amenorrhoea");
  });

  it("does not flag amenorrhoea during pregnancy", () => {
    const result = predictCycle(
      input({
        periods: [{ startDate: "2026-04-01", endDate: "2026-04-05" }],
        today: "2026-09-02",
        lifeStage: "pregnant",
      })
    );
    expect(flagIds(result)).not.toContain("amenorrhoea");
  });

  it("flags cycles that are consistently short or long", () => {
    const short = predictCycle(input({ periods: regularPeriods("2026-08-20", 5, 21, 4) }));
    expect(flagIds(short)).toContain("short_cycles");

    const long = predictCycle(input({ periods: regularPeriods("2026-08-20", 5, 45) }));
    expect(flagIds(long)).toContain("long_cycles");
  });

  it("does not flag cycle length on a normal-range history", () => {
    const result = predictCycle(input({ periods: regularPeriods("2026-08-20", 6, 30) }));
    expect(flagIds(result)).not.toContain("short_cycles");
    expect(flagIds(result)).not.toContain("long_cycles");
  });

  it("flags bleeding lasting more than eight days", () => {
    const result = predictCycle(
      input({
        periods: [
          { startDate: "2026-07-01", endDate: "2026-07-05" },
          { startDate: "2026-08-01", endDate: addDays("2026-08-01", NORMAL_PERIOD_MAX_DAYS) },
        ],
      })
    );
    expect(flagIds(result)).toContain("prolonged_bleeding");
  });

  it("still flags a three-week bleed while keeping it out of the period-length average", () => {
    // The database stores durations up to 30 days (a typo guard) while the
    // engine averages only up to 15. This is the case where those two bounds
    // meet: an abnormal 21-day bleed must be flagged from the raw dates, yet
    // must not drag "your typical period length" up with it.
    const result = predictCycle(
      input({
        periods: [
          { startDate: "2026-06-01", endDate: "2026-06-05" },
          { startDate: "2026-07-01", endDate: "2026-07-05" },
          { startDate: "2026-08-01", endDate: "2026-08-21" },
        ],
        today: "2026-08-25",
      })
    );
    expect(flagIds(result)).toContain("prolonged_bleeding");
    expect(result.stats.averagePeriodDurationDays).toBe(5);
  });

  it("flags repeated very heavy flow but not a single heavy day", () => {
    const periods = regularPeriods("2026-08-20", 4, 28);
    expect(
      flagIds(predictCycle(input({ periods, heavyFlowDates: ["2026-08-21"] })))
    ).not.toContain("heavy_bleeding");
    expect(
      flagIds(predictCycle(input({ periods, heavyFlowDates: ["2026-08-21", "2026-08-22"] })))
    ).toContain("heavy_bleeding");
  });

  it("classifies a swing over nine days as irregular", () => {
    const variable: ObservedPeriod[] = [{ startDate: "2026-01-01", endDate: "2026-01-05" }];
    for (const length of [25, 36, 27, 30]) {
      const previous = variable[variable.length - 1].startDate;
      const startDate = addDays(previous, length);
      variable.push({ startDate, endDate: addDays(startDate, 4) });
    }
    const result = predictCycle(input({ periods: variable, today: "2026-06-01" }));
    expect(result.stats.regularity).toBe("irregular");
    expect(flagIds(result)).toContain("irregular_cycles");
  });

  it("classifies a swing within nine days as regular", () => {
    const periods: ObservedPeriod[] = [{ startDate: "2026-01-01", endDate: "2026-01-05" }];
    for (const length of [27, 30, 28, 31]) {
      const previous = periods[periods.length - 1].startDate;
      const startDate = addDays(previous, length);
      periods.push({ startDate, endDate: addDays(startDate, 4) });
    }
    const result = predictCycle(input({ periods, today: "2026-06-01" }));
    expect(result.stats.regularity).toBe("regular");
    expect(result.flags.map((flag) => flag.id)).not.toContain("irregular_cycles");
  });
});

describe("nextPeriodSummary", () => {
  const periods = regularPeriods("2026-08-01", 7, 28); // next period 2026-08-29

  function on(today: string) {
    return nextPeriodSummary(predictCycle(input({ periods, today })));
  }

  it("counts down while the period is still ahead", () => {
    expect(on("2026-08-24")).toBe("5 days to your next period");
    expect(on("2026-08-28")).toBe("1 day to your next period");
  });

  it("says today on the estimated date", () => {
    expect(on("2026-08-29")).toBe("Expected around today");
  });

  it("says any day now once past the estimate but inside the window", () => {
    // The regression this helper exists for: isOverdue is still false here
    // while daysUntilNextPeriod has gone negative. Inline, this branch used
    // to render "Log a period to begin" to somebody with six logged cycles.
    const prediction = predictCycle(input({ periods, today: "2026-08-30" }));
    expect(prediction.isOverdue).toBe(false);
    expect(prediction.daysUntilNextPeriod).toBeLessThan(0);
    expect(nextPeriodSummary(prediction)).toBe("Expected any day now");
  });

  it("switches to the overdue wording once the window has passed", () => {
    expect(on("2026-09-05")).toBe("since your estimated date");
  });

  it("only asks for a first period when there genuinely is none", () => {
    expect(nextPeriodSummary(predictCycle(input({ periods: [] })))).toBe(
      "Log a period to begin"
    );
  });
});
