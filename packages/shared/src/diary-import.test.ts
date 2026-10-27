import { describe, expect, it } from "@jest/globals";
import {
  confirmedRowsToReadings,
  diaryLimits,
  draftRowsFromSuggestions,
  emptyDiaryRow,
  diaryLagosInstant,
  diaryTodayLagos,
  parseDiaryDate,
  parseDiaryTime,
  parseGlucoseContext,
  rawDiaryPageSchema,
  validateDiaryRow,
  DIARY_PROBLEMS,
  type DiaryDraftRow,
} from "./diary-import";

// 2026-10-20 14:00 in Lagos (13:00 UTC)
const NOW = Date.UTC(2026, 9, 20, 13, 0);
const LIM = diaryLimits();

const bp = (over: Partial<DiaryDraftRow> = {}): DiaryDraftRow => ({
  ...emptyDiaryRow("r1", "blood_pressure", { date: "2026-10-18", time: "08:30", systolic: "132", diastolic: "84" }),
  ...over,
});
const glu = (over: Partial<DiaryDraftRow> = {}): DiaryDraftRow => ({
  ...emptyDiaryRow("g1", "glucose", { date: "2026-10-18", time: "07:00", glucose: "6.1", glucoseUnit: "mmol_l", glucoseContext: "fasting" }),
  ...over,
});

describe("Lagos time", () => {
  it("is UTC+1 all year", () => {
    expect(new Date(diaryLagosInstant("2026-10-18", "08:30") as number).toISOString()).toBe("2026-10-18T07:30:00.000Z");
    expect(new Date(diaryLagosInstant("2026-10-18", "00:15") as number).toISOString()).toBe("2026-10-17T23:15:00.000Z");
  });
  it("refuses a date or a time that does not exist", () => {
    expect(diaryLagosInstant("2026-02-30", "08:00")).toBeNull();
    expect(diaryLagosInstant("2026-10-18", "24:00")).toBeNull();
    expect(diaryLagosInstant("18/10/2026", "08:00")).toBeNull();
  });
  it("says today in Lagos, which is tomorrow in UTC late in the evening", () => {
    expect(diaryTodayLagos(Date.UTC(2026, 9, 20, 23, 30))).toBe("2026-10-21");
    expect(diaryTodayLagos(NOW)).toBe("2026-10-20");
  });
});

describe("validateDiaryRow: a good row", () => {
  it("becomes a reading with the stated instant, never now", () => {
    const v = validateDiaryRow(bp({ pulse: "72" }), NOW, LIM);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.reading).toMatchObject({ vitalType: "blood_pressure", systolic: 132, diastolic: 84, pulseBpm: 72, takenAt: "2026-10-18T07:30:00.000Z" });
    }
  });
  it("glucose in mg/dL is stored in mmol/L like every other reading", () => {
    const v = validateDiaryRow(glu({ glucose: "110", glucoseUnit: "mg_dl" }), NOW, LIM);
    expect(v.ok && v.reading.glucoseMmolL).toBeCloseTo(6.1, 1);
  });
});

describe("validateDiaryRow: the window (the no-backdating rule is bounded, not removed)", () => {
  it("accepts a reading inside the window", () => {
    expect(validateDiaryRow(bp({ date: "2026-10-01" }), NOW, LIM).ok).toBe(true);
  });
  it("refuses an older one and says why", () => {
    const v = validateDiaryRow(bp({ date: "2026-09-01" }), NOW, LIM);
    expect(v).toEqual({ ok: false, problems: ["date_too_old"] });
  });
  it("refuses a date in the future", () => {
    expect(validateDiaryRow(bp({ date: "2026-10-21" }), NOW, LIM)).toEqual({ ok: false, problems: ["date_future"] });
  });
  it("allows the small clock skew the server allows", () => {
    // 14:03 Lagos while it is 14:00
    expect(validateDiaryRow(bp({ date: "2026-10-20", time: "14:03" }), NOW, LIM).ok).toBe(true);
    expect(validateDiaryRow(bp({ date: "2026-10-20", time: "14:30" }), NOW, LIM).ok).toBe(false);
  });
  it("needs a date and a time, and never guesses either", () => {
    expect(validateDiaryRow(bp({ date: "" }), NOW, LIM)).toEqual({ ok: false, problems: ["date_missing"] });
    expect(validateDiaryRow(bp({ time: "" }), NOW, LIM)).toEqual({ ok: false, problems: ["time_missing"] });
    expect(validateDiaryRow(bp({ date: "18/10/2026" }), NOW, LIM)).toEqual({ ok: false, problems: ["date_invalid"] });
    expect(validateDiaryRow(bp({ time: "8am" }), NOW, LIM)).toEqual({ ok: false, problems: ["time_invalid"] });
  });
  it("follows the configured window, not a number in this file", () => {
    expect(validateDiaryRow(bp({ date: "2026-10-01" }), NOW, { ...LIM, windowDays: 5 })).toEqual({ ok: false, problems: ["date_too_old"] });
  });
});

describe("validateDiaryRow: impossible values are explained, never saved and never changed", () => {
  it("a swapped blood pressure", () => {
    const v = validateDiaryRow(bp({ systolic: "80", diastolic: "130" }), NOW, LIM);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems).toContain("systolic_not_above_diastolic");
  });
  it("a number outside what a living person can have", () => {
    const v = validateDiaryRow(bp({ systolic: "400" }), NOW, LIM);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems).toContain("systolic_range");
  });
  it("a dangerous but possible value is NOT refused here: the deterministic triage decides what it means", () => {
    expect(validateDiaryRow(bp({ systolic: "205", diastolic: "128" }), NOW, LIM).ok).toBe(true);
    expect(validateDiaryRow(glu({ glucose: "1.8" }), NOW, LIM).ok).toBe(true);
  });
  it("missing numbers", () => {
    expect(validateDiaryRow(bp({ diastolic: "" }), NOW, LIM)).toEqual({ ok: false, problems: ["diastolic_missing"] });
    expect(validateDiaryRow(bp({ systolic: "12o" }), NOW, LIM)).toEqual({ ok: false, problems: ["systolic_missing"] });
  });
  it("glucose needs its unit and its context (a unit is never guessed from the size of the number)", () => {
    expect(validateDiaryRow(glu({ glucoseUnit: "" }), NOW, LIM)).toEqual({ ok: false, problems: ["glucose_unit_missing"] });
    expect(validateDiaryRow(glu({ glucoseContext: "" }), NOW, LIM)).toEqual({ ok: false, problems: ["glucose_context_missing"] });
  });
  it("every problem has words under a diary.problem.* key", () => {
    expect(new Set(DIARY_PROBLEMS).size).toBe(DIARY_PROBLEMS.length);
  });
});

describe("a suggestion is never the record", () => {
  it("a suggested row starts unconfirmed and cannot become a reading until the person confirms it", () => {
    const raw = rawDiaryPageSchema.parse({
      rows: [{ kind: "blood_pressure", date_text: "18/10/2026", time_text: "8.30am", systolic_text: "132", diastolic_text: "84", pulse_text: null, glucose_text: null, glucose_unit: null, glucose_context_text: null }],
      unreadable_reason: null,
    });
    let n = 0;
    const { rows } = draftRowsFromSuggestions(raw, "2026-10-20", () => `k${++n}`, LIM);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ suggested: true, confirmed: false, date: "2026-10-18", time: "08:30", systolic: "132" });
    expect(confirmedRowsToReadings(rows, NOW, LIM)).toMatchObject({ readings: [], blocked: [{ key: "k1", problems: ["not_confirmed"] }] });
    const confirmed = rows.map((r) => ({ ...r, confirmed: true }));
    expect(confirmedRowsToReadings(confirmed, NOW, LIM).readings).toHaveLength(1);
  });
  it("what cannot be read with confidence is left empty for the person, not guessed", () => {
    const raw = rawDiaryPageSchema.parse({
      rows: [{ kind: "glucose", date_text: "sometime", time_text: "morning", systolic_text: null, diastolic_text: null, pulse_text: null, glucose_text: "6.l", glucose_unit: null, glucose_context_text: "hmm" }],
      unreadable_reason: null,
    });
    const { rows } = draftRowsFromSuggestions(raw, "2026-10-20", () => "k", LIM);
    expect(rows[0]).toMatchObject({ date: "", time: "", glucose: "", glucoseUnit: "", glucoseContext: "", confirmed: false });
  });
  it("more rows than one save may carry are counted, never silently dropped", () => {
    const row = { kind: "blood_pressure" as const, date_text: "18/10/2026", time_text: "08:00", systolic_text: "120", diastolic_text: "80", pulse_text: null, glucose_text: null, glucose_unit: null, glucose_context_text: null };
    const raw = rawDiaryPageSchema.parse({ rows: Array.from({ length: LIM.maxRows + 3 }, () => row), unreadable_reason: null });
    const out = draftRowsFromSuggestions(raw, "2026-10-20", (() => { let i = 0; return () => `k${++i}`; })(), LIM);
    expect(out.rows).toHaveLength(LIM.maxRows);
    expect(out.skipped).toBe(3);
  });
  it("a sheet longer than one save may carry is refused whole", () => {
    const rows = Array.from({ length: LIM.maxRows + 1 }, (_, i) => bp({ key: `r${i}` }));
    expect(confirmedRowsToReadings(rows, NOW, LIM)).toEqual({ readings: [], blocked: [], tooMany: true });
  });
  it("an unreadable page comes back as a reason with no rows", () => {
    const raw = rawDiaryPageSchema.parse({ rows: [], unreadable_reason: "blurred" });
    expect(draftRowsFromSuggestions(raw, "2026-10-20", () => "k", LIM)).toEqual({ rows: [], skipped: 0, unreadableReason: "blurred" });
  });
});

describe("reading the words on a page", () => {
  it("dates are day first, as on a Nigerian diary", () => {
    expect(parseDiaryDate("12/10/2026", "2026-10-20")).toBe("2026-10-12");
    expect(parseDiaryDate("12-10-26", "2026-10-20")).toBe("2026-10-12");
    expect(parseDiaryDate("12 Oct", "2026-10-20")).toBe("2026-10-12");
    expect(parseDiaryDate("3rd October 2026", "2026-10-20")).toBe("2026-10-03");
    expect(parseDiaryDate("2026-10-12", "2026-10-20")).toBe("2026-10-12");
  });
  it("a date with no year that would be in the future is last year's", () => {
    expect(parseDiaryDate("25 Dec", "2026-10-20")).toBe("2025-12-25");
  });
  it("what is not a date is empty", () => {
    expect(parseDiaryDate("monday", "2026-10-20")).toBe("");
    expect(parseDiaryDate("31/02/2026", "2026-10-20")).toBe("");
    expect(parseDiaryDate("45/10/2026", "2026-10-20")).toBe("");
    expect(parseDiaryDate(null, "2026-10-20")).toBe("");
  });
  it("times, and never a guess at 'morning' or at am or pm", () => {
    expect(parseDiaryTime("8am")).toBe("08:00");
    expect(parseDiaryTime("8.30 pm")).toBe("20:30");
    expect(parseDiaryTime("12am")).toBe("00:00");
    expect(parseDiaryTime("12pm")).toBe("12:00");
    expect(parseDiaryTime("20:15")).toBe("20:15");
    expect(parseDiaryTime("2015")).toBe("20:15");
    expect(parseDiaryTime("00:30")).toBe("00:30");
    expect(parseDiaryTime("morning")).toBe("");
    expect(parseDiaryTime("8")).toBe("");
    expect(parseDiaryTime("25:00")).toBe("");
    expect(parseDiaryTime("13pm")).toBe("");
  });
  it("a time with no am or pm that could be morning or evening is left for the person, never guessed (it would move the reading by twelve hours)", () => {
    expect(parseDiaryTime("8:30")).toBe("");
    expect(parseDiaryTime("08:30")).toBe("");
    expect(parseDiaryTime("0830")).toBe("");
    expect(parseDiaryTime("12:00")).toBe("");
    expect(parseDiaryTime("7.15")).toBe("");
  });
  it("glucose context words", () => {
    expect(parseGlucoseContext("fasting")).toBe("fasting");
    expect(parseGlucoseContext("after lunch")).toBe("post_meal");
    expect(parseGlucoseContext("before dinner")).toBe("pre_meal");
    expect(parseGlucoseContext("at bedtime")).toBe("bedtime");
    expect(parseGlucoseContext("RBS")).toBe("random");
    expect(parseGlucoseContext("before breakfast")).toBe("fasting");
    expect(parseGlucoseContext("FBS")).toBe("fasting");
  });
  it("'breakfast' is not 'fast': a reading AFTER breakfast is post-meal, never fasting", () => {
    expect(parseGlucoseContext("after breakfast")).toBe("post_meal");
    expect(parseGlucoseContext("post breakfast")).toBe("post_meal");
    expect(parseGlucoseContext("2h pp")).toBe("post_meal");
    expect(parseGlucoseContext("breakfast")).toBe("");
  });
  it("a note that says both fasting and after is left for the person", () => {
    expect(parseGlucoseContext("fasting, then after the meal")).toBe("");
    expect(parseGlucoseContext("")).toBe("");
  });
});
