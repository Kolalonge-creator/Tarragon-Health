import { en, pcm } from "@tarragon/i18n";
import { buildTrendInsights, WEEKDAY_KEYS, type TrendInsightsInput } from "./bp-trend-insights";
import { lagosTimeToUtcMs } from "./lagos-date";
import type { AveragingProtocol } from "./bp-average";
import type { AverageGateConfig, StartingSuggestionTarget, TrendDisplayConfig } from "./s07-config";
import type { BpReading } from "./vitals";

// Pinned on purpose: these tests cover the logic, not the current proposed numbers.
const protocol: AveragingProtocol = { minGapMinutes: 1, morningHours: [4, 12], eveningHours: [17, 24] };
const gate: AverageGateConfig = {
  version: 0,
  windowDays: 7,
  rules: [
    { minReadings: 3, minDays: 3, minPerDay: 1 },
    { minReadings: 4, minDays: 2, minPerDay: 2 },
  ],
};
const display: TrendDisplayConfig = { version: 0, minReadingsForChart: 3, gapBreakDays: 2 };
const suggestion: StartingSuggestionTarget = { version: 0, systolicBelow: 135, diastolicBelow: 85 };

const TODAY = "2026-10-04"; // a Sunday
const NOW = lagosTimeToUtcMs(TODAY, "12:00") as number;
const LATE = lagosTimeToUtcMs(TODAY, "22:00") as number; // after an evening reading today, which the chart (and so the card) would otherwise treat as the future
const r = (date: string, time: string, systolic: number, diastolic: number, id = `${date}-${time}`): BpReading => ({
  id,
  systolic,
  diastolic,
  takenAt: new Date(lagosTimeToUtcMs(date, time) as number).toISOString(),
  level: "green",
});
const TARGET = { systolicBelow: 130, diastolicBelow: 80, setBy: "staff-1", setAt: "2026-09-30T09:00:00Z" };
const build = (readings: BpReading[], over: Partial<TrendInsightsInput> = {}) =>
  buildTrendInsights({ readings, nowMs: NOW, windowDays: 7, personal: TARGET, protocol, gate, display, suggestion, ...over });

describe("chart or list", () => {
  it("is a list below the minimum and a chart at it", () => {
    expect(build([r("2026-10-03", "08:00", 120, 80), r("2026-10-04", "08:00", 120, 80)]).displayMode).toBe("list");
    expect(build([r("2026-10-02", "08:00", 120, 80), r("2026-10-03", "08:00", 120, 80), r("2026-10-04", "08:00", 120, 80)]).displayMode).toBe("chart");
  });

  it("does not count a double save as an extra reading toward the chart", () => {
    const dup = [r("2026-10-03", "08:00", 120, 80), r("2026-10-03", "08:00", 120, 80), r("2026-10-04", "08:00", 120, 80)];
    const out = build(dup);
    expect(out.readingCount).toBe(2);
    expect(out.displayMode).toBe("list");
    expect(out.ignoredClose).toBe(1);
  });
});

describe("average and the gate", () => {
  it("shows an average only when there are enough readings, with the morning and evening split", () => {
    const out = build([
      r("2026-10-02", "08:00", 140, 90),
      r("2026-10-03", "08:00", 130, 80),
      r("2026-10-04", "07:00", 135, 85),
      r("2026-10-04", "19:00", 135, 85),
    ], { nowMs: LATE });
    expect(out.average).toEqual({ readings: 4, days: 3, systolic: 135, diastolic: 85 });
    expect(out.shortfall).toBeNull();
    expect(out.morningAverage?.count).toBe(3);
    expect(out.eveningAverage?.count).toBe(1);
  });

  it("says what is missing instead of a thin average", () => {
    const out = build([r("2026-10-03", "08:00", 140, 90), r("2026-10-04", "08:00", 150, 95)]);
    expect(out.average).toBeNull();
    expect(out.morningAverage).toBeNull();
    expect(out.shortfall).toEqual({ moreDays: 1, moreReadings: 1, minPerDay: 1 });
  });

  it("counts exactly what the chart draws, including a reading from the afternoon of the earliest day", () => {
    // Now is noon on 4 Oct. The chart's 7 day window starts at noon on 27 Sep (Lagos).
    const edge = r("2026-09-27", "13:00", 150, 95); // inside the chart window, on the earliest calendar day
    const before = r("2026-09-27", "11:00", 150, 95); // an hour before the chart window starts
    const out = build([edge, before, r("2026-10-03", "08:00", 120, 78), r("2026-10-04", "08:00", 120, 78)]);
    expect(out.readingCount).toBe(3);
    expect(out.displayMode).toBe("chart");
    expect(out.days.map((d) => d.localDate)).toContain("2026-09-27");
    expect(out.days.find((d) => d.localDate === "2026-09-27")?.count).toBe(1);
  });

  it("leaves out a reading from the future, as the chart does", () => {
    expect(build([r("2026-10-04", "19:00", 150, 95)]).readingCount).toBe(0); // now is noon
    expect(build([r("2026-10-04", "19:00", 150, 95)], { nowMs: LATE }).readingCount).toBe(1);
  });

  it("does not hide a lone reading from the chart window by calling it too few and showing nothing", () => {
    const out = build([r("2026-09-27", "13:00", 190, 118)]);
    expect(out.readingCount).toBe(1);
    expect(out.days).toHaveLength(1);
    expect(out.days[0]).toMatchObject({ meanSystolic: 190, aboveCount: 1, status: "above" });
  });

  it("uses the 30 day window when asked, so older readings count there and not in the 7 day view", () => {
    const old = [r("2026-09-20", "08:00", 130, 80), r("2026-09-21", "08:00", 130, 80), r("2026-09-22", "08:00", 130, 80)];
    expect(build(old, { windowDays: 7 }).readingCount).toBe(0);
    const thirty = build(old, { windowDays: 30 });
    expect(thirty.readingCount).toBe(3);
    expect(thirty.average).toMatchObject({ readings: 3, days: 3 });
  });
});

describe("the target", () => {
  it("is the care team's when a clinician and a date are recorded on the row", () => {
    expect(build([]).target).toEqual({ kind: "care_team", systolicBelow: 130, diastolicBelow: 80 });
    expect(build([], { personal: null }).target).toEqual({ kind: "none" });
    expect(build([], { personal: { ...TARGET, setBy: null } }).target).toEqual({ kind: "none" });
    expect(build([], { personal: { ...TARGET, setAt: " " } }).target).toEqual({ kind: "none" });
  });

  it("follows the server's own answer: its care team target, or the standard starting target labelled as such", () => {
    expect(build([], { personal: { ...TARGET, setBy: null, origin: "care_team" } }).target).toMatchObject({ kind: "care_team" });
    const standard = build([], { personal: { systolicBelow: 135, diastolicBelow: 85, setBy: null, setAt: null, origin: "standard" } });
    expect(standard.target).toEqual({ kind: "standard", systolicBelow: 135, diastolicBelow: 85 });
    // a standard target is never promoted to the care team's by carrying a clinician and date
    expect(build([], { personal: { ...TARGET, origin: "standard" } }).target).toMatchObject({ kind: "standard" });
  });

  it("measures statuses against the server's standard target too, so a high reading is never left unmarked", () => {
    const personal = { systolicBelow: 135, diastolicBelow: 85, setBy: null, setAt: null, origin: "standard" as const };
    const out = build([r("2026-10-04", "08:00", 150, 90)], { personal });
    expect(out.days[0]).toMatchObject({ aboveCount: 1, status: "above" });
    expect(build([r("2026-10-04", "08:00", 120, 80)], { personal }).days[0]).toMatchObject({ aboveCount: 0, status: "not_above" });
  });

  it("gives no statuses at all when no target could be read, so it cannot contradict the server's own target", () => {
    const out = build([r("2026-10-04", "08:00", 200, 120)], { personal: null });
    expect(out.days[0]).toMatchObject({ aboveCount: null, status: null });
    // the flat suggestion in the app is never used to grade anything
    expect(build([r("2026-10-04", "08:00", 200, 120)], { personal: { ...TARGET, setBy: null } }).days[0]?.status).toBeNull();
  });
});

describe("the per-day list", () => {
  const days = build([
    r("2026-10-01", "08:00", 120, 78),
    r("2026-10-02", "08:00", 150, 95),
    r("2026-10-02", "19:00", 118, 76),
    r("2026-10-04", "08:00", 129, 79),
  ]).days;

  it("is newest first, with the weekday and DD/MM", () => {
    expect(days.map((d) => d.localDate)).toEqual(["2026-10-04", "2026-10-02", "2026-10-01"]);
    expect(days[0]).toMatchObject({ weekdayKey: "trends.weekday.0", dayMonth: "04/10" }); // Sunday
    expect(days[2]).toMatchObject({ weekdayKey: "trends.weekday.4", dayMonth: "01/10" }); // Thursday
  });

  it("calls a day above when ANY reading was at or above the target, even if its average is not", () => {
    const d = days.find((x) => x.localDate === "2026-10-02");
    expect(d).toMatchObject({ count: 2, meanSystolic: 134, aboveCount: 1, status: "above" });
    // The day's average (134/86) is above here too, so check a case where it is not:
    const masked = build([r("2026-10-04", "08:00", 131, 81), r("2026-10-04", "19:00", 100, 60)], { nowMs: LATE }).days[0];
    expect(masked).toMatchObject({ meanSystolic: 116, aboveCount: 1, status: "above" });
  });

  it("says not above when no reading was, and never calls a low reading 'within' anything", () => {
    expect(days.find((x) => x.localDate === "2026-10-04")).toMatchObject({ aboveCount: 0, status: "not_above" });
    const low = build([r("2026-10-04", "08:00", 75, 45)]).days[0];
    expect(low?.status).toBe("not_above");
  });

  it("treats a reading exactly at the target as above, the same as the server", () => {
    expect(build([r("2026-10-04", "08:00", 130, 70)]).days[0]?.status).toBe("above");
    expect(build([r("2026-10-04", "08:00", 120, 80)]).days[0]?.status).toBe("above");
    expect(build([r("2026-10-04", "08:00", 129, 79)]).days[0]?.status).toBe("not_above");
  });

  it("buckets a reading by its Lagos day", () => {
    const late = { ...r("2026-10-03", "23:30", 120, 80), takenAt: "2026-10-03T22:30:00.000Z" }; // 23:30 on the 3rd, Lagos
    const early = { ...r("2026-10-04", "00:30", 120, 80), takenAt: "2026-10-03T23:30:00.000Z" }; // 00:30 on the 4th, Lagos
    const out = build([late, early]).days.map((d) => d.localDate);
    expect(out).toEqual(["2026-10-04", "2026-10-03"]);
  });
});

describe("weekday keys", () => {
  it.each(WEEKDAY_KEYS.map((k) => [k]))("%s exists in English and Pidgin", (key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((pcm as Record<string, string>)[key]).toBeTruthy();
  });
});
