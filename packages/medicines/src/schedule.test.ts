import { describe, expect, it } from "@jest/globals";
import { addDays, daysBetween, isValidLocalDate, isValidTime, lagosLocalDate, lagosTimeToUtcMs, weekdayOf } from "./lagos";
import { MAX_WINDOW_MINUTES, windowEndTime, allTimes, parseScheduleSpec, slotCloseMinutes, slotKey, slotsBetween, slotsOn, specFromLegacyTimes } from "./schedule";
import { SCHEDULE_CASES } from "./schedule.fixtures";
import type { ScheduleSpec } from "./types";

describe("lagos date helpers", () => {
  it("validates dates and times", () => {
    expect(isValidLocalDate("2026-10-05")).toBe(true);
    expect(isValidLocalDate("2026-02-30")).toBe(false);
    expect(isValidLocalDate("26-10-05")).toBe(false);
    expect(isValidLocalDate(5)).toBe(false);
    expect(isValidTime("08:00")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("8:00")).toBe(false);
    expect(isValidTime(null)).toBe(false);
  });
  it("buckets an instant into the Lagos day, whatever the phone zone", () => {
    expect(lagosLocalDate(Date.parse("2026-10-05T22:59:59Z"))).toBe("2026-10-05");
    expect(lagosLocalDate(Date.parse("2026-10-05T23:00:00Z"))).toBe("2026-10-06");
  });
  it("does month, year and leap arithmetic", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(daysBetween("2026-12-31", "2027-01-02")).toBe(2);
    expect(weekdayOf("2026-10-05")).toBe(1);
  });
  it("converts a Lagos wall time to UTC and refuses bad input", () => {
    expect(lagosTimeToUtcMs("2026-10-05", "08:00")).toBe(Date.parse("2026-10-05T07:00:00Z"));
    expect(() => lagosTimeToUtcMs("2026-10-05", "8am")).toThrow(RangeError);
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});

describe("slot expansion (cases shared with the database proof)", () => {
  it.each(SCHEDULE_CASES)("$name", ({ spec, date, times }) => {
    expect(slotsOn(spec, date).map((s) => s.time)).toEqual(times);
  });
  it("carries the taper dose text", () => {
    const taper = SCHEDULE_CASES.find((c) => c.name === "taper step 2");
    expect(slotsOn(taper!.spec, taper!.date)[0].doseText).toBe("1 tablet");
  });
  it("sorts and returns the same slots for a range", () => {
    const spec = SCHEDULE_CASES[0].spec;
    const slots = slotsBetween(spec, "2026-10-05", "2026-10-06");
    expect(slots.map((s) => `${s.date} ${s.time}`)).toEqual([
      "2026-10-05 08:00",
      "2026-10-05 20:00",
      "2026-10-06 08:00",
      "2026-10-06 20:00",
    ]);
  });
  it("returns nothing for a backwards range and refuses a very long one", () => {
    expect(slotsBetween(SCHEDULE_CASES[0].spec, "2026-10-06", "2026-10-05")).toEqual([]);
    expect(() => slotsBetween(SCHEDULE_CASES[0].spec, "2026-01-01", "2028-01-01")).toThrow(RangeError);
  });
  it("a taper built without a start date has no slots", () => {
    const spec = { startDate: null, endDate: null, foodNote: null, kind: "taper", steps: [{ days: 2, times: ["08:00"], doseText: "x" }] } as ScheduleSpec;
    expect(slotsOn(spec, "2026-10-05")).toEqual([]);
  });
  it("a taper day before its start has no slots", () => {
    const taper = SCHEDULE_CASES.find((c) => c.name === "taper step 1")!;
    expect(slotsOn({ ...taper.spec, startDate: "2026-10-04" } as ScheduleSpec, "2026-10-03")).toEqual([]);
  });
  it("makes a stable slot key", () => {
    expect(slotKey("m1", { date: "2026-10-05", time: "08:00" })).toBe("m1|2026-10-05|08:00");
  });
  it("the same dose lands on the same Lagos day across a spring-forward month", () => {
    // No daylight saving in Lagos: 08:00 is 07:00 UTC on both sides of the dates that shift London and New York.
    expect(lagosTimeToUtcMs("2026-03-29", "08:00") % 86400000).toBe(lagosTimeToUtcMs("2026-03-30", "08:00") % 86400000);
    expect(lagosTimeToUtcMs("2026-11-01", "08:00") % 86400000).toBe(lagosTimeToUtcMs("2026-11-02", "08:00") % 86400000);
  });
});

describe("parseScheduleSpec", () => {
  const ok = (input: unknown) => {
    const r = parseScheduleSpec(input);
    if (!r.ok) throw new Error(r.errors.join(","));
    return r.spec;
  };
  const errs = (input: unknown) => {
    const r = parseScheduleSpec(input);
    return r.ok ? [] : r.errors;
  };

  it("accepts each kind and normalises times", () => {
    expect(ok({ kind: "daily", times: ["20:00", "08:00", "08:00"] })).toMatchObject({ kind: "daily", times: ["08:00", "20:00"] });
    expect(ok({ kind: "every_n_days", times: ["08:00"], intervalDays: 3, anchorDate: "2026-10-01", foodNote: "with_food" })).toMatchObject({ intervalDays: 3, foodNote: "with_food" });
    expect(ok({ kind: "weekdays", times: ["08:00"], days: [4, 1, 1] })).toMatchObject({ days: [1, 4] });
    expect(ok({ kind: "taper", startDate: "2026-10-01", steps: [{ days: 2, times: ["08:00"], doseText: " half " }] })).toMatchObject({ steps: [{ doseText: "half" }] });
    expect(ok({ kind: "as_needed" })).toMatchObject({ maxPerDay: null });
    expect(ok({ kind: "as_needed", maxPerDay: 4, startDate: "2026-10-01", endDate: "2026-10-31" })).toMatchObject({ maxPerDay: 4 });
  });
  it("refuses a non-object, unknown kind and bad common fields", () => {
    expect(errs("x")).toEqual(["spec:shape"]);
    expect(errs([])).toEqual(["spec:shape"]);
    expect(errs({ kind: "monthly" })).toContain("kind");
    expect(errs({ kind: "daily", times: ["08:00"], startDate: "bad" })).toContain("startDate:format");
    expect(errs({ kind: "daily", times: ["08:00"], startDate: "2026-10-05", endDate: "2026-10-01" })).toContain("endDate:before_start");
    expect(errs({ kind: "daily", times: ["08:00"], foodNote: "lots" })).toContain("foodNote");
  });
  it("refuses bad times", () => {
    expect(errs({ kind: "daily" })).toContain("times:count");
    expect(errs({ kind: "daily", times: [] })).toContain("times:count");
    expect(errs({ kind: "daily", times: Array(13).fill("08:00") })).toContain("times:count");
    expect(errs({ kind: "daily", times: ["08:00", "25:00"] })).toContain("times:format");
  });
  it("refuses a bad interval, anchor, weekday list", () => {
    expect(errs({ kind: "every_n_days", times: ["08:00"], intervalDays: 1, anchorDate: "2026-10-01" })).toContain("intervalDays");
    expect(errs({ kind: "every_n_days", times: ["08:00"], intervalDays: 2.5, anchorDate: "2026-10-01" })).toContain("intervalDays");
    expect(errs({ kind: "every_n_days", times: ["08:00"], intervalDays: 2 })).toContain("anchorDate:required");
    expect(errs({ kind: "every_n_days", times: ["08:00"], intervalDays: "2", anchorDate: "2026-10-01" })).toContain("intervalDays");
    expect(errs({ kind: "weekdays", times: ["08:00"], days: [] })).toContain("days");
    expect(errs({ kind: "weekdays", times: ["08:00"], days: [7] })).toContain("days");
    expect(errs({ kind: "weekdays", times: ["08:00"] })).toContain("days");
  });
  it("refuses bad tapers", () => {
    expect(errs({ kind: "taper", startDate: "2026-10-01", steps: [] })).toContain("steps:count");
    expect(errs({ kind: "taper", startDate: "2026-10-01" })).toContain("steps:count");
    expect(errs({ kind: "taper", steps: [{ days: 2, times: ["08:00"], doseText: "x" }] })).toContain("startDate:required_for_taper");
    const bad = errs({ kind: "taper", startDate: "2026-10-01", steps: [{ days: 0, times: [], doseText: "" }, "nope"] });
    expect(bad).toEqual(expect.arrayContaining(["steps[0].days", "steps[0].times:count", "steps[0].doseText", "steps[1].days"]));
    expect(errs({ kind: "taper", startDate: "2026-10-01", steps: [{ days: "2", times: ["08:00"], doseText: "x".repeat(81) }] })).toEqual(expect.arrayContaining(["steps[0].days", "steps[0].doseText"]));
    expect(errs({ kind: "taper", startDate: "2026-10-01", steps: Array(25).fill({ days: 1, times: ["08:00"], doseText: "x" }) })).toContain("steps:count");
  });
  it("refuses a bad as-needed limit", () => {
    expect(errs({ kind: "as_needed", maxPerDay: 0 })).toContain("maxPerDay");
    expect(errs({ kind: "as_needed", maxPerDay: "3" })).toContain("maxPerDay");
  });
});

describe("flexible windows", () => {
  const daily = { kind: "daily", times: ["08:00"] };
  it("parses a window, defaults to the exact time, and refuses a bad one", () => {
    expect(parseScheduleSpec({ ...daily, windowMinutes: 120 })).toMatchObject({ ok: true, spec: { windowMinutes: 120 } });
    expect(parseScheduleSpec(daily)).toMatchObject({ ok: true, spec: { windowMinutes: 0 } });
    expect(parseScheduleSpec({ ...daily, windowMinutes: null })).toMatchObject({ ok: true, spec: { windowMinutes: 0 } });
    expect(parseScheduleSpec({ ...daily, windowMinutes: MAX_WINDOW_MINUTES })).toMatchObject({ ok: true });
    for (const bad of [-5, 361, 12.5, "60"]) {
      expect(parseScheduleSpec({ ...daily, windowMinutes: bad })).toEqual({ ok: false, errors: ["windowMinutes"] });
    }
  });
  it("closes a slot at the longer of the missed window and the schedule's own window", () => {
    const spec = (windowMinutes?: number) => ({ startDate: null, endDate: null, foodNote: null, kind: "as_needed" as const, maxPerDay: null, windowMinutes });
    expect(slotCloseMinutes(spec(undefined), 120)).toBe(120);
    expect(slotCloseMinutes(spec(60), 120)).toBe(120);
    expect(slotCloseMinutes(spec(240), 120)).toBe(240);
  });
  it("refuses a window that reaches the next dose time, counting the wrap to tomorrow", () => {
    expect(parseScheduleSpec({ kind: "daily", times: ["08:00", "10:00"], windowMinutes: 120 })).toEqual({ ok: false, errors: ["windowMinutes:overlap"] });
    expect(parseScheduleSpec({ kind: "daily", times: ["08:00", "10:00"], windowMinutes: 119 })).toMatchObject({ ok: true });
    expect(parseScheduleSpec({ kind: "daily", times: ["01:00", "23:00"], windowMinutes: 180 })).toEqual({ ok: false, errors: ["windowMinutes:overlap"] });
    expect(parseScheduleSpec({ kind: "daily", times: ["01:00", "23:00"], windowMinutes: 119 })).toMatchObject({ ok: true });
    expect(parseScheduleSpec({ kind: "daily", times: ["08:00"], windowMinutes: 360 })).toMatchObject({ ok: true });
  });
  it("checks every step of a step-down and ignores as-needed", () => {
    const steps = (t: string[]) => [{ days: 2, times: t, doseText: "x" }];
    expect(parseScheduleSpec({ kind: "taper", startDate: "2026-10-01", steps: steps(["08:00", "09:00"]), windowMinutes: 60 })).toEqual({ ok: false, errors: ["windowMinutes:overlap"] });
    expect(parseScheduleSpec({ kind: "taper", startDate: "2026-10-01", steps: steps(["08:00", "20:00"]), windowMinutes: 60 })).toMatchObject({ ok: true });
    expect(parseScheduleSpec({ kind: "as_needed", windowMinutes: 120 })).toMatchObject({ ok: true });
  });
  it("names the end of a window and wraps past midnight", () => {
    expect(windowEndTime("08:00", 120)).toBe("10:00");
    expect(windowEndTime("23:00", 120)).toBe("01:00");
    expect(windowEndTime("09:30", 45)).toBe("10:15");
  });
  it("does not change which slots exist", () => {
    expect(slotsOn({ startDate: null, endDate: null, foodNote: null, kind: "daily", times: ["08:00"], windowMinutes: 180 }, "2026-10-05").map((s) => s.time)).toEqual(["08:00"]);
  });
});

describe("allTimes", () => {
  it("lists every time a schedule can use", () => {
    expect(allTimes(SCHEDULE_CASES[0].spec)).toEqual(["08:00", "20:00"]);
    const taper = SCHEDULE_CASES.find((c) => c.name === "taper step 1")!;
    expect(allTimes(taper.spec)).toEqual(["08:00", "20:00"]);
    expect(allTimes({ startDate: null, endDate: null, foodNote: null, kind: "as_needed", maxPerDay: null })).toEqual([]);
  });
});

describe("specFromLegacyTimes", () => {
  it("turns the old list of times into a daily schedule", () => {
    expect(specFromLegacyTimes(["20:00", "08:00", "bad", "08:00"])).toMatchObject({ kind: "daily", times: ["08:00", "20:00"] });
  });
  it("gives an as-needed schedule when there are no usable times", () => {
    expect(specFromLegacyTimes([])).toMatchObject({ kind: "as_needed" });
    expect(specFromLegacyTimes(null)).toMatchObject({ kind: "as_needed" });
    expect(specFromLegacyTimes(["bad"])).toMatchObject({ kind: "as_needed" });
  });
});
