import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ANCHOR_IDS,
  MAX_ANCHOR_OFFSET,
  MIN_ANCHOR_OFFSET,
  anchorBaseTime,
  buildAnchorProfile,
  effectiveFromFor,
  planDayShift,
  type AnchorId,
  isAnchorId,
  isAnchorOffset,
  resolveAnchoredDose,
  shiftOffsetOn,
  validateDayShift,
  type AnchorProfile,
} from "./anchors";
import { ANCHOR_CASES, TEST_ANCHOR_DEFAULTS } from "./anchors.fixtures";
import { allTimes, anchorChangeConflicts, parseScheduleSpec, slotsBetween, slotsOn, toStoredSpec } from "./schedule";

/** Anchor times given as plain "HH:MM" are in force from the start; versions carry their own dates. */
const profileOf = (
  patientTimes: Partial<Record<AnchorId, string>> = {},
  shifts: AnchorProfile["shifts"] = [],
  versions: AnchorProfile["times"] = {}
): AnchorProfile => {
  const times: AnchorProfile["times"] = { ...versions };
  for (const [anchor, time] of Object.entries(patientTimes) as [AnchorId, string][]) times[anchor] = [{ effectiveFrom: "2000-01-01", time }];
  return { defaults: TEST_ANCHOR_DEFAULTS, times, shifts };
};

describe("anchored dose resolution (cases shared with the database proof)", () => {
  it.each(ANCHOR_CASES)("$name", ({ spec, patientTimes, patientVersions, shifts, expect: byDate }) => {
    const parsed = parseScheduleSpec(spec, profileOf(patientTimes, shifts, patientVersions));
    if (!parsed.ok) throw new Error(`fixture does not parse: ${parsed.errors.join(",")}`);
    for (const [date, times] of Object.entries(byDate)) {
      expect({ date, times: slotsOn(parsed.spec, date).map((s) => s.time) }).toEqual({ date, times });
    }
  });

  it("the database proof carries every one of these cases by name", () => {
    const proof = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "db", "tests", "s08z_dose_anchors.sql"), "utf8");
    for (const c of ANCHOR_CASES) expect(proof).toContain(c.name);
  });

  it("a hand-built taper or as-needed schedule that names anchors never resolves them", () => {
    const profile = profileOf();
    const anchored = [{ anchor: "breakfast" as const, offsetMinutes: 0 }];
    const taper = { kind: "taper" as const, startDate: "2026-10-01", endDate: null, foodNote: null, steps: [{ days: 5, times: ["08:00"], doseText: "one" }], anchored, anchorProfile: profile };
    expect(slotsOn(taper, "2026-10-02").map((s) => s.time)).toEqual(["08:00"]);
    const prn = { kind: "as_needed" as const, startDate: null, endDate: null, foodNote: null, maxPerDay: null, anchored, anchorProfile: profile };
    expect(slotsOn(prn, "2026-10-02")).toEqual([]);
  });

  it("an anchored slot says which anchor it came from; a fixed one carries no such key", () => {
    const parsed = parseScheduleSpec(
      { kind: "daily", times: ["21:00"], anchored: [{ anchor: "dinner", offsetMinutes: 30 }] },
      profileOf({ dinner: "19:00" })
    );
    if (!parsed.ok) throw new Error("fixture");
    const slots = slotsOn(parsed.spec, "2026-10-05");
    expect(slots.find((s) => s.time === "19:30")?.anchored).toEqual({ anchor: "dinner", offsetMinutes: 30 });
    expect("anchored" in (slots.find((s) => s.time === "21:00") ?? {})).toBe(false);
  });

  it("slotsBetween walks the same resolution across a range", () => {
    const parsed = parseScheduleSpec(
      { kind: "daily", times: [], anchored: [{ anchor: "bedtime", offsetMinutes: 60 }] },
      profileOf({ bedtime: "23:30" })
    );
    if (!parsed.ok) throw new Error("fixture");
    expect(slotsBetween(parsed.spec, "2026-10-05", "2026-10-07").map((s) => `${s.date} ${s.time}`)).toEqual([
      "2026-10-05 00:30",
      "2026-10-06 00:30",
      "2026-10-07 00:30",
    ]);
  });

  it("a schedule that names an anchor and has no profile attached yields only its fixed times, never a guess", () => {
    const parsed = parseScheduleSpec({ kind: "daily", times: ["21:00"], anchored: [{ anchor: "breakfast", offsetMinutes: 0 }] });
    if (!parsed.ok) throw new Error("fixture");
    expect(slotsOn(parsed.spec, "2026-10-05").map((s) => s.time)).toEqual(["21:00"]);
    expect(allTimes(parsed.spec)).toEqual(["21:00"]);
  });
});

describe("anchor helpers", () => {
  it("knows the anchors and offsets", () => {
    expect(ANCHOR_IDS).toHaveLength(10);
    expect(isAnchorId("breakfast")).toBe(true);
    expect(isAnchorId("brunch")).toBe(false);
    expect(isAnchorId(3)).toBe(false);
    expect(isAnchorOffset(0)).toBe(true);
    expect(isAnchorOffset(MIN_ANCHOR_OFFSET)).toBe(true);
    expect(isAnchorOffset(MAX_ANCHOR_OFFSET)).toBe(true);
    expect(isAnchorOffset(MAX_ANCHOR_OFFSET + 1)).toBe(false);
    expect(isAnchorOffset(MIN_ANCHOR_OFFSET - 1)).toBe(false);
    expect(isAnchorOffset(1.5)).toBe(false);
    expect(isAnchorOffset("30")).toBe(false);
  });

  it("uses the patient's time, and falls back to the default when none or an unusable one is stored", () => {
    expect(anchorBaseTime(profileOf({ lunch: "12:40" }), "lunch")).toBe("12:40");
    expect(anchorBaseTime(profileOf(), "lunch")).toBe("13:00");
    expect(anchorBaseTime(profileOf({ lunch: "noon" }), "lunch")).toBe("13:00");
  });

  it("takes the latest version in force on the date, whatever order the versions arrive in, and the latest of all with no date", () => {
    const versions: AnchorProfile["times"] = {
      lunch: [
        { effectiveFrom: "2026-10-10", time: "12:00" },
        { effectiveFrom: "2026-10-01", time: "12:30" },
      ],
    };
    const p = profileOf({}, [], versions);
    expect(anchorBaseTime(p, "lunch", "2026-09-30")).toBe("13:00");
    expect(anchorBaseTime(p, "lunch", "2026-10-05")).toBe("12:30");
    expect(anchorBaseTime(p, "lunch", "2026-10-10")).toBe("12:00");
    expect(anchorBaseTime(p, "lunch")).toBe("12:00");
  });

  it("shiftOffsetOn ignores dates outside a shift and a non-number offset", () => {
    const shifts = [{ startsOn: "2026-10-05", endsOn: "2026-10-06", offsets: { dinner: 30, lunch: Number.NaN } }];
    expect(shiftOffsetOn(profileOf({}, shifts), "dinner", "2026-10-04")).toBe(0);
    expect(shiftOffsetOn(profileOf({}, shifts), "dinner", "2026-10-05")).toBe(30);
    expect(shiftOffsetOn(profileOf({}, shifts), "dinner", "2026-10-07")).toBe(0);
    expect(shiftOffsetOn(profileOf({}, shifts), "lunch", "2026-10-05")).toBe(0);
    expect(shiftOffsetOn(profileOf({}, shifts), "waking", "2026-10-05")).toBe(0);
  });

  it("a shift ended early stops applying from the date it was ended, and a null end changes nothing", () => {
    const base = { startsOn: "2026-10-05", endsOn: "2026-10-09", offsets: { dinner: 30 } };
    expect(shiftOffsetOn(profileOf({}, [{ ...base, cancelledFrom: "2026-10-07" }]), "dinner", "2026-10-06")).toBe(30);
    expect(shiftOffsetOn(profileOf({}, [{ ...base, cancelledFrom: "2026-10-07" }]), "dinner", "2026-10-07")).toBe(0);
    expect(shiftOffsetOn(profileOf({}, [{ ...base, cancelledFrom: null }]), "dinner", "2026-10-08")).toBe(30);
  });

  it("resolves exactly at the day boundaries", () => {
    const p = profileOf({ bedtime: "23:59", waking: "00:00" });
    expect(resolveAnchoredDose(p, { anchor: "bedtime", offsetMinutes: 1 }, "2026-10-05")).toEqual({ date: "2026-10-06", time: "00:00" });
    expect(resolveAnchoredDose(p, { anchor: "waking", offsetMinutes: -1 }, "2026-10-05")).toEqual({ date: "2026-10-04", time: "23:59" });
    expect(resolveAnchoredDose(p, { anchor: "waking", offsetMinutes: 0 }, "2026-10-05")).toEqual({ date: "2026-10-05", time: "00:00" });
    expect(resolveAnchoredDose(p, { anchor: "bedtime", offsetMinutes: 0 }, "2026-10-05")).toEqual({ date: "2026-10-05", time: "23:59" });
    // Month and year edges.
    expect(resolveAnchoredDose(p, { anchor: "bedtime", offsetMinutes: 60 }, "2026-12-31")).toEqual({ date: "2027-01-01", time: "00:59" });
  });
});

describe("validateDayShift", () => {
  const ok = { startsOn: "2026-10-05", endsOn: "2026-11-03", offsets: { breakfast: -60, dinner: 120 } };
  it("accepts a good shift up to the longest allowed run", () => {
    expect(validateDayShift(ok, 30)).toEqual([]);
    expect(validateDayShift({ ...ok, endsOn: "2026-10-05" }, 30)).toEqual([]);
  });
  it("refuses a run that is too long, backwards or not a date", () => {
    expect(validateDayShift(ok, 29)).toEqual(["range:too_long"]);
    expect(validateDayShift({ ...ok, endsOn: "2026-10-04" }, 30)).toEqual(["endsOn:before_start"]);
    expect(validateDayShift({ ...ok, startsOn: "soon" }, 30)).toEqual(["startsOn:format"]);
    expect(validateDayShift({ ...ok, endsOn: 5 }, 30)).toEqual(["endsOn:format"]);
  });
  it("refuses bad offsets and a bad shape", () => {
    expect(validateDayShift({ ...ok, offsets: {} }, 30)).toEqual(["offsets:empty"]);
    expect(validateDayShift({ ...ok, offsets: [] }, 30)).toEqual(["offsets:shape"]);
    expect(validateDayShift({ ...ok, offsets: null }, 30)).toEqual(["offsets:shape"]);
    expect(validateDayShift({ ...ok, offsets: { brunch: 5 } }, 30)).toEqual(["offsets.brunch:unknown_anchor"]);
    expect(validateDayShift({ ...ok, offsets: { dinner: 361 } }, 30)).toEqual(["offsets.dinner:range"]);
    expect(validateDayShift({ ...ok, offsets: { dinner: 1.5 } }, 30)).toEqual(["offsets.dinner:range"]);
    expect(validateDayShift({ ...ok, offsets: { dinner: "30" } }, 30)).toEqual(["offsets.dinner:range"]);
    expect(validateDayShift(null, 30)).toEqual(["shift:shape"]);
    expect(validateDayShift([], 30)).toEqual(["shift:shape"]);
  });
});

describe("parsing anchored schedules", () => {
  const anchoredBreakfast = [{ anchor: "breakfast", offsetMinutes: 0 }];
  const errorsOf = (spec: unknown, profile?: AnchorProfile): string[] => {
    const r = parseScheduleSpec(spec, profile);
    return r.ok ? [] : r.errors;
  };

  it("lets an anchored-only schedule carry no clock times, for daily, every-N-days and weekdays", () => {
    expect(errorsOf({ kind: "daily", anchored: anchoredBreakfast })).toEqual([]);
    expect(errorsOf({ kind: "daily", times: [], anchored: anchoredBreakfast })).toEqual([]);
    expect(errorsOf({ kind: "every_n_days", intervalDays: 2, anchorDate: "2026-10-01", anchored: anchoredBreakfast })).toEqual([]);
    expect(errorsOf({ kind: "weekdays", days: [1], anchored: anchoredBreakfast })).toEqual([]);
  });

  it("still refuses a schedule with neither clock times nor anchors", () => {
    expect(errorsOf({ kind: "daily", times: [] })).toContain("times:count");
    expect(errorsOf({ kind: "daily" })).toContain("times:count");
  });

  it("refuses anchors on a taper or an as-needed schedule", () => {
    expect(errorsOf({ kind: "as_needed", anchored: anchoredBreakfast })).toContain("anchored:kind");
    expect(
      errorsOf({ kind: "taper", startDate: "2026-10-01", steps: [{ days: 3, times: ["08:00"], doseText: "one" }], anchored: anchoredBreakfast })
    ).toContain("anchored:kind");
  });

  it("refuses an unknown anchor, a bad offset, a repeat and a bad list", () => {
    expect(errorsOf({ kind: "daily", anchored: [{ anchor: "brunch", offsetMinutes: 0 }] })).toContain("anchored[0].anchor");
    expect(errorsOf({ kind: "daily", anchored: [{ anchor: "lunch", offsetMinutes: 500 }] })).toContain("anchored[0].offsetMinutes");
    expect(errorsOf({ kind: "daily", anchored: [null] })).toEqual(expect.arrayContaining(["anchored[0].anchor", "anchored[0].offsetMinutes"]));
    expect(
      errorsOf({ kind: "daily", anchored: [{ anchor: "lunch", offsetMinutes: 0 }, { anchor: "lunch", offsetMinutes: 0 }] })
    ).toContain("anchored[1]:duplicate");
    expect(errorsOf({ kind: "daily", anchored: "breakfast" })).toContain("anchored:count");
    expect(errorsOf({ kind: "daily", anchored: Array.from({ length: 13 }, (_, i) => ({ anchor: "lunch", offsetMinutes: i })) })).toContain("anchored:count");
  });

  it("counts clock times and anchored doses together against the daily limit", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
    expect(errorsOf({ kind: "daily", times: eleven, anchored: anchoredBreakfast })).toEqual([]);
    expect(
      errorsOf({ kind: "daily", times: eleven, anchored: [{ anchor: "breakfast", offsetMinutes: 0 }, { anchor: "lunch", offsetMinutes: 0 }] })
    ).toContain("times:count");
  });

  it("sorts the anchored doses so the stored form is stable", () => {
    const r = parseScheduleSpec({
      kind: "daily",
      anchored: [
        { anchor: "dinner", offsetMinutes: 30 },
        { anchor: "breakfast", offsetMinutes: 0 },
        { anchor: "dinner", offsetMinutes: -30 },
      ],
    });
    if (!r.ok) throw new Error("fixture");
    expect(r.spec.anchored).toEqual([
      { anchor: "breakfast", offsetMinutes: 0 },
      { anchor: "dinner", offsetMinutes: -30 },
      { anchor: "dinner", offsetMinutes: 30 },
    ]);
  });

  it("checks a flexible window against the resolved times when the profile is given", () => {
    const spec = { kind: "daily", windowMinutes: 90, times: [], anchored: [{ anchor: "breakfast", offsetMinutes: 0 }, { anchor: "waking", offsetMinutes: 0 }] };
    // Waking 06:30 and breakfast 07:30 are an hour apart: a 90 minute window would overlap.
    expect(errorsOf(spec, profileOf())).toContain("windowMinutes:overlap");
    expect(errorsOf(spec, profileOf({ breakfast: "09:30" }))).toEqual([]);
    // With no profile only the clock times can be checked.
    expect(errorsOf(spec)).toEqual([]);
  });

  it("allTimes lists anchored doses at their normal times, and the stored form drops the runtime profile", () => {
    const r = parseScheduleSpec({ kind: "daily", times: ["21:00"], anchored: [{ anchor: "breakfast", offsetMinutes: 15 }] }, profileOf({ breakfast: "08:00" }));
    if (!r.ok) throw new Error("fixture");
    expect(allTimes(r.spec)).toEqual(["08:15", "21:00"]);
    const stored = toStoredSpec(r.spec);
    expect("anchorProfile" in stored).toBe(false);
    expect(stored.anchored).toEqual([{ anchor: "breakfast", offsetMinutes: 15 }]);
    expect(r.spec.anchorProfile).toBeDefined();
  });

  it("a plain clock-time schedule parsed with a profile attached behaves exactly as before", () => {
    const r = parseScheduleSpec({ kind: "daily", times: ["08:00", "20:00"], windowMinutes: 30 }, profileOf());
    if (!r.ok) throw new Error("fixture");
    expect(allTimes(r.spec)).toEqual(["08:00", "20:00"]);
    expect(slotsOn(r.spec, "2026-10-05").map((s) => s.time)).toEqual(["08:00", "20:00"]);
    expect(errorsOf({ kind: "daily", times: ["08:00", "08:20"], windowMinutes: 30 }, profileOf())).toContain("windowMinutes:overlap");
  });

  it("wraps an anchored time that crosses midnight when listing the normal times", () => {
    const r = parseScheduleSpec({ kind: "daily", anchored: [{ anchor: "bedtime", offsetMinutes: 90 }] }, profileOf({ bedtime: "23:30" }));
    if (!r.ok) throw new Error("fixture");
    expect(allTimes(r.spec)).toEqual(["01:00"]);
  });
});

describe("effective dates and shift planning", () => {
  it("a change applies today, or tomorrow when today already has answers", () => {
    expect(effectiveFromFor("2026-10-05", false)).toBe("2026-10-05");
    expect(effectiveFromFor("2026-10-05", true)).toBe("2026-10-06");
    expect(effectiveFromFor("2026-10-31", true)).toBe("2026-11-01");
  });

  const input = { startsOn: "2026-10-05", endsOn: "2026-10-20", offsets: { breakfast: -60, dinner: 90, lunch: 0 } };
  it("drops parts left at no change and keeps the dates", () => {
    expect(planDayShift(input, "2026-10-05", false, 45)).toEqual({ ok: true, startsOn: "2026-10-05", endsOn: "2026-10-20", offsets: { breakfast: -60, dinner: 90 } });
  });
  it("never starts before today, and starts tomorrow when today has answers", () => {
    expect(planDayShift({ ...input, startsOn: "2026-10-01" }, "2026-10-05", false, 45)).toMatchObject({ ok: true, startsOn: "2026-10-05" });
    expect(planDayShift(input, "2026-10-05", true, 45)).toMatchObject({ ok: true, startsOn: "2026-10-06" });
    expect(planDayShift({ ...input, startsOn: "2026-10-08" }, "2026-10-05", true, 45)).toMatchObject({ ok: true, startsOn: "2026-10-08" });
  });
  it("refuses a shift with nothing to move, bad dates, a run that is too long, an offset out of range, or one already over", () => {
    expect(planDayShift({ ...input, offsets: { lunch: 0 } }, "2026-10-05", false, 45)).toEqual({ ok: false, error: "offsets" });
    expect(planDayShift({ ...input, offsets: { dinner: 400 } }, "2026-10-05", false, 45)).toEqual({ ok: false, error: "offsets" });
    expect(planDayShift({ ...input, endsOn: "2026-10-04" }, "2026-10-05", false, 45)).toEqual({ ok: false, error: "dates" });
    expect(planDayShift({ ...input, endsOn: "2026-12-30" }, "2026-10-05", false, 45)).toEqual({ ok: false, error: "dates" });
    expect(planDayShift({ ...input, startsOn: "soon" }, "2026-10-05", false, 45)).toEqual({ ok: false, error: "dates" });
    expect(planDayShift({ ...input, startsOn: "2026-09-01", endsOn: "2026-09-10" }, "2026-10-05", false, 45)).toEqual({ ok: false, error: "not_applicable" });
    expect(planDayShift({ ...input, startsOn: "2026-10-05", endsOn: "2026-10-05" }, "2026-10-05", true, 45)).toEqual({ ok: false, error: "not_applicable" });
  });
});

describe("anchorChangeConflicts", () => {
  const spec = (extra: Record<string, unknown>, profile = profileOf()) => {
    const r = parseScheduleSpec({ kind: "daily", ...extra }, profile);
    if (!r.ok) throw new Error(`fixture: ${r.errors.join(",")}`);
    return r.spec;
  };
  const two = { anchored: [{ anchor: "waking", offsetMinutes: 0 }, { anchor: "breakfast", offsetMinutes: 0 }], windowMinutes: 30 };

  it("flags a medicine whose window would overlap after the move, and not one that still fits", () => {
    const meds = [{ id: "a", spec: spec(two) }];
    // Waking 06:30, breakfast moved to 06:45: 15 minutes apart, inside a 30 minute window.
    expect(anchorChangeConflicts(meds, profileOf(), { breakfast: "06:45" })).toEqual(["a"]);
    expect(anchorChangeConflicts(meds, profileOf(), { breakfast: "08:30" })).toEqual([]);
  });

  it("judges changes together: a pair that is fine is not refused because one half alone would overlap the old other half", () => {
    const pair = { anchored: [{ anchor: "breakfast", offsetMinutes: 0 }, { anchor: "lunch", offsetMinutes: 0 }], windowMinutes: 60 };
    const meds = [{ id: "a", spec: spec(pair) }];
    // Test defaults: breakfast 07:30, lunch 13:00. Breakfast alone at 12:30 would be 30 minutes from lunch.
    expect(anchorChangeConflicts(meds, profileOf(), { breakfast: "12:30" })).toEqual(["a"]);
    expect(anchorChangeConflicts(meds, profileOf(), { breakfast: "12:30", lunch: "18:00" })).toEqual([]);
    expect(anchorChangeConflicts(meds, profileOf(), {})).toEqual([]);
  });

  it("ignores medicines with no window, no anchored doses, or a kind that cannot carry them", () => {
    const noWindow = spec({ anchored: two.anchored });
    const clockOnly = spec({ times: ["06:30", "06:40"], windowMinutes: 5 });
    const taper = { kind: "taper" as const, startDate: "2026-10-01", endDate: null, foodNote: null, steps: [{ days: 3, times: ["08:00"], doseText: "one" }] };
    const prn = { kind: "as_needed" as const, startDate: null, endDate: null, foodNote: null, maxPerDay: null };
    // A hand-built spec that never set a window at all.
    const unset = { kind: "daily" as const, startDate: null, endDate: null, foodNote: null, times: [], anchored: two.anchored as never };
    const meds = [
      { id: "a", spec: noWindow },
      { id: "b", spec: clockOnly },
      { id: "c", spec: taper },
      { id: "d", spec: prn },
      { id: "e", spec: unset },
    ];
    expect(anchorChangeConflicts(meds, profileOf(), { breakfast: "06:45" })).toEqual([]);
  });

  it("counts the same time twice as one dose, as the database does", () => {
    const meds = [{ id: "a", spec: spec({ times: ["07:30"], anchored: [{ anchor: "breakfast", offsetMinutes: 0 }], windowMinutes: 30 }) }];
    expect(anchorChangeConflicts(meds, profileOf(), { dinner: "20:00" })).toEqual([]);
  });
});

describe("buildAnchorProfile", () => {
  it("reads versions and shifts, ignores rows it cannot read, and lists shifts oldest first", () => {
    const profile = buildAnchorProfile(
      TEST_ANCHOR_DEFAULTS,
      [
        { anchor: "breakfast", effective_from: "2026-10-01", local_time: "08:00" },
        { anchor: "breakfast", effective_from: "2026-10-10", local_time: "09:00" },
        { anchor: "brunch", effective_from: "2026-10-01", local_time: "10:00" },
        { anchor: "lunch", effective_from: "2026-10-01", local_time: "25:00" },
        { anchor: "dinner", effective_from: "soon", local_time: "19:00" },
      ],
      [
        { id: "b", starts_on: "2026-10-06", ends_on: "2026-10-08", offsets: { dinner: -30, brunch: 5, lunch: Number.NaN }, cancelled_from: null, created_at: "2026-10-02T00:00:00Z" },
        { id: "a", starts_on: "2026-10-05", ends_on: "2026-10-09", offsets: { dinner: 60 }, cancelled_from: "2026-10-08", created_at: "2026-10-01T00:00:00Z" },
        { id: "c", starts_on: "2026-10-05", ends_on: "2026-10-09", offsets: { dinner: 15 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" },
        { id: "bad", starts_on: "x", ends_on: "2026-10-09", offsets: { dinner: 60 }, cancelled_from: null, created_at: "2026-10-03T00:00:00Z" },
        { id: "worse", starts_on: "2026-10-05", ends_on: "2026-10-09", offsets: null as never, cancelled_from: null, created_at: "2026-10-03T00:00:00Z" },
      ]
    );
    expect(profile.times.breakfast).toHaveLength(2);
    expect(profile.times.lunch).toBeUndefined();
    expect(profile.times.dinner).toBeUndefined();
    expect(Object.keys(profile.times)).toEqual(["breakfast"]);
    expect(profile.shifts.map((s) => s.offsets)).toEqual([{ dinner: 60 }, { dinner: 15 }, { dinner: -30 }]);
    expect(profile.shifts[0]?.cancelledFrom).toBe("2026-10-08");
    expect(profile.defaults).toBe(TEST_ANCHOR_DEFAULTS);
  });
});
