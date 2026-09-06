import {
  computeCycleInsights,
  describeInsight,
  type CycleInsightsInput,
  type DailyLogEntry,
} from "./cycle-insights";
import { addDays, type ObservedPeriod } from "./cycle-prediction";

/** `count` cycles of `cycleLength`, the earliest starting at `firstStart`. */
function periodsFrom(firstStart: string, count: number, cycleLength = 28): ObservedPeriod[] {
  return Array.from({ length: count }, (_, i) => {
    const startDate = addDays(firstStart, cycleLength * i);
    return { startDate, endDate: addDays(startDate, 4) };
  });
}

/** A log of `symptom` on the given cycle day of each listed cycle. */
function logsOnDay(
  firstStart: string,
  cycleLength: number,
  cycleIndexes: number[],
  dayOfCycle: number,
  symptoms: string[],
  moods: string[] = []
): DailyLogEntry[] {
  return cycleIndexes.map((i) => ({
    date: addDays(firstStart, cycleLength * i + (dayOfCycle - 1)),
    symptoms,
    moods,
  }));
}

function input(over: Partial<CycleInsightsInput> = {}): CycleInsightsInput {
  return {
    periods: periodsFrom("2026-03-01", 6),
    dailyLogs: [],
    today: "2026-08-01",
    expectedCycleLengthDays: 28,
    averagePeriodDurationDays: 5,
    ...over,
  };
}

describe("computeCycleInsights", () => {
  it("returns nothing without at least two cycles to compare", () => {
    expect(
      computeCycleInsights(
        input({ periods: periodsFrom("2026-07-01", 1), today: "2026-07-20" })
      )
    ).toEqual([]);
  });

  it("does not call a one-off a pattern", () => {
    // Logged in a single cycle only. An anecdote, not a pattern.
    const result = computeCycleInsights(
      input({ dailyLogs: logsOnDay("2026-03-01", 28, [0], 1, ["cramps"]) })
    );
    expect(result).toEqual([]);
  });

  it("finds a symptom that recurs on the same cycle day", () => {
    const result = computeCycleInsights(
      input({ dailyLogs: logsOnDay("2026-03-01", 28, [0, 1, 2, 3, 4], 1, ["cramps"]) })
    );
    const cramps = result.find((i) => i.key === "cramps");
    expect(cramps).toBeDefined();
    expect(cramps?.cyclesWithIt).toBe(5);
    expect(cramps?.medianDay).toBe(1);
    expect(cramps?.typicalStartDay).toBe(1);
    expect(cramps?.typicalEndDay).toBe(1);
    expect(cramps?.phase).toBe("menstrual");
  });

  it("reports a range when the symptom moves around", () => {
    const logs = [
      ...logsOnDay("2026-03-01", 28, [0], 1, ["bloating"]),
      ...logsOnDay("2026-03-01", 28, [1], 3, ["bloating"]),
      ...logsOnDay("2026-03-01", 28, [2], 2, ["bloating"]),
      ...logsOnDay("2026-03-01", 28, [3], 4, ["bloating"]),
    ];
    const result = computeCycleInsights(input({ dailyLogs: logs }));
    const bloating = result.find((i) => i.key === "bloating");
    expect(bloating?.typicalStartDay).toBeLessThan(bloating!.typicalEndDay);
  });

  it("places a late-cycle symptom in the luteal phase", () => {
    // Day 24 of a 28-day cycle: past ovulation (day 14) and its window.
    const result = computeCycleInsights(
      input({ dailyLogs: logsOnDay("2026-03-01", 28, [0, 1, 2], 24, ["headache"]) })
    );
    expect(result.find((i) => i.key === "headache")?.phase).toBe("luteal");
  });

  it("tracks moods separately from symptoms", () => {
    const result = computeCycleInsights(
      input({ dailyLogs: logsOnDay("2026-03-01", 28, [0, 1, 2], 26, [], ["irritable"]) })
    );
    const mood = result.find((i) => i.key === "irritable");
    expect(mood?.kind).toBe("mood");
    expect(mood?.cyclesWithIt).toBe(3);
  });

  it("ranks the most consistent pattern first", () => {
    const logs = [
      ...logsOnDay("2026-03-01", 28, [0, 1, 2, 3, 4, 5], 1, ["cramps"]),
      ...logsOnDay("2026-03-01", 28, [0, 1], 10, ["nausea"]),
    ];
    const result = computeCycleInsights(input({ dailyLogs: logs }));
    expect(result[0].key).toBe("cramps");
    expect(result[0].frequency).toBeGreaterThan(result[1].frequency);
  });

  it("ignores logs that fall outside any cycle", () => {
    const logs = [
      // Well before the first recorded period.
      { date: "2026-01-01", symptoms: ["cramps"], moods: [] },
      ...logsOnDay("2026-03-01", 28, [0, 1], 1, ["cramps"]),
    ];
    const result = computeCycleInsights(input({ dailyLogs: logs }));
    expect(result.find((i) => i.key === "cramps")?.cyclesWithIt).toBe(2);
  });

  it("does not treat a long logging gap as a cycle", () => {
    // Two periods eight months apart: that span is a gap, not a cycle
    // somebody had symptoms "in", so it must not become a comparison window.
    const periods: ObservedPeriod[] = [
      { startDate: "2026-01-01", endDate: "2026-01-05" },
      { startDate: "2026-09-01", endDate: "2026-09-05" },
    ];
    const result = computeCycleInsights(
      input({
        periods,
        today: "2026-09-10",
        dailyLogs: [
          { date: "2026-01-02", symptoms: ["cramps"], moods: [] },
          { date: "2026-09-02", symptoms: ["cramps"], moods: [] },
        ],
      })
    );
    expect(result).toEqual([]);
  });

  it("counts a symptom logged twice in one cycle as one cycle", () => {
    const logs = [
      ...logsOnDay("2026-03-01", 28, [0], 1, ["cramps"]),
      ...logsOnDay("2026-03-01", 28, [0], 2, ["cramps"]),
      ...logsOnDay("2026-03-01", 28, [1], 1, ["cramps"]),
    ];
    const result = computeCycleInsights(input({ dailyLogs: logs }));
    expect(result.find((i) => i.key === "cramps")?.cyclesWithIt).toBe(2);
  });
});

describe("describeInsight", () => {
  const base = computeCycleInsights(
    input({ dailyLogs: logsOnDay("2026-03-01", 28, [0, 1, 2, 3, 4, 5], 1, ["cramps"]) })
  )[0];

  it("says every cycle when it really was every cycle", () => {
    expect(describeInsight(base, "Cramps")).toBe(
      "Cramps: usually around day 1, in every one of your last 6 cycles."
    );
  });

  it("gives the count when it was not every cycle", () => {
    const partial = computeCycleInsights(
      input({ dailyLogs: logsOnDay("2026-03-01", 28, [0, 1, 2], 1, ["cramps"]) })
    )[0];
    expect(describeInsight(partial, "Cramps")).toBe(
      "Cramps: usually around day 1, in 3 of your last 6 cycles."
    );
  });

  it("describes a range when the days vary", () => {
    const logs = [
      ...logsOnDay("2026-03-01", 28, [0], 1, ["bloating"]),
      ...logsOnDay("2026-03-01", 28, [1], 5, ["bloating"]),
      ...logsOnDay("2026-03-01", 28, [2], 3, ["bloating"]),
    ];
    const insight = computeCycleInsights(input({ dailyLogs: logs }))[0];
    expect(describeInsight(insight, "Bloating")).toContain("around days");
  });
});
