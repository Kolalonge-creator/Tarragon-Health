import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { en } from "@tarragon/i18n";
import { buildWeeklySummary, parseWeeklyConfig, WeeklyConfigError, type WeeklyInput } from "./weekly-summary";

const CFG = parseWeeklyConfig((getProposedConfig("today.home_cards").value as { weekly: unknown }).weekly);
const NONE: WeeklyInput = { bloodPressure: null, activity: null, meals: null, medicines: null };
const bp = (n: number, sys: number, dia: number) => Array.from({ length: n }, () => ({ systolic: sys, diastolic: dia }));

describe("parseWeeklyConfig", () => {
  it("reads the proposed configuration", () => {
    expect(CFG).toEqual({ minBpReadings: 3, windowDays: 7 });
  });
  it("refuses a bad configuration", () => {
    for (const bad of [null, [], "x"]) expect(() => parseWeeklyConfig(bad)).toThrow(WeeklyConfigError);
    expect(() => parseWeeklyConfig({ min_bp_readings: 0, window_days: 7 })).toThrow(WeeklyConfigError);
    expect(() => parseWeeklyConfig({ min_bp_readings: 1.5, window_days: 7 })).toThrow(WeeklyConfigError);
    expect(() => parseWeeklyConfig({ min_bp_readings: 3, window_days: 30 })).toThrow(WeeklyConfigError);
  });
});

describe("buildWeeklySummary", () => {
  it("has no cards when no source is known", () => {
    expect(buildWeeklySummary(CFG, NONE).cards).toEqual([]);
  });

  it("blood pressure: counts readings under the person's own target, without a verdict", () => {
    const readings = [...bp(3, 120, 78), ...bp(2, 150, 95)];
    const { cards } = buildWeeklySummary(CFG, { ...NONE, bloodPressure: { readings, target: { systolicBelow: 135, diastolicBelow: 85 } } });
    expect(cards).toEqual([{ code: "blood_pressure", state: "ready", title: { key: "weekly.bp.title" }, line: { key: "weekly.bp.ready", params: { count: 5, under: 3 } } }]);
  });

  it("blood pressure: both numbers must be under the target", () => {
    const { cards } = buildWeeklySummary(CFG, { ...NONE, bloodPressure: { readings: [...bp(2, 120, 90), ...bp(2, 140, 70)], target: { systolicBelow: 135, diastolicBelow: 85 } } });
    expect(cards[0]?.line.params).toEqual({ count: 4, under: 0 });
  });

  it("blood pressure: a calm not-enough card below the minimum, and none of the numbers", () => {
    const { cards } = buildWeeklySummary(CFG, { ...NONE, bloodPressure: { readings: bp(2, 120, 80), target: { systolicBelow: 135, diastolicBelow: 85 } } });
    expect(cards[0]).toMatchObject({ code: "blood_pressure", state: "not_enough", line: { key: "weekly.bp.not_enough", params: { min: 3 } } });
  });

  it("blood pressure: with no target it counts readings only and compares nothing", () => {
    const { cards } = buildWeeklySummary(CFG, { ...NONE, bloodPressure: { readings: bp(4, 130, 80), target: null } });
    expect(cards[0]).toMatchObject({ state: "ready", line: { key: "weekly.bp.no_target", params: { count: 4 } } });
  });

  it("activity: minutes against the person's own goal; no card without a goal", () => {
    expect(buildWeeklySummary(CFG, { ...NONE, activity: { activeMinutes: 40, goalMinutes: 150 } }).cards[0]).toMatchObject({ code: "activity", line: { params: { minutes: 40, goal: 150 } } });
    expect(buildWeeklySummary(CFG, { ...NONE, activity: { activeMinutes: 40, goalMinutes: 0 } }).cards).toEqual([]);
  });

  it("meals: days logged, and a neutral line for none", () => {
    expect(buildWeeklySummary(CFG, { ...NONE, meals: { daysLogged: 4 } }).cards[0]?.line).toEqual({ key: "weekly.meals.ready", params: { days: 4 } });
    expect(buildWeeklySummary(CFG, { ...NONE, meals: { daysLogged: 0 } }).cards[0]?.line).toEqual({ key: "weekly.meals.none" });
  });

  it("medicines: doses marked taken over doses due; not-enough when the adherence formula gives no percent; no card with nothing due", () => {
    expect(buildWeeklySummary(CFG, { ...NONE, medicines: { due: 14, markedTaken: 12, percent: 86 } }).cards[0]).toMatchObject({ state: "ready", line: { params: { taken: 12, due: 14 } } });
    expect(buildWeeklySummary(CFG, { ...NONE, medicines: { due: 2, markedTaken: 2, percent: null } }).cards[0]).toMatchObject({ state: "not_enough", line: { key: "weekly.medicines.not_enough" } });
    expect(buildWeeklySummary(CFG, { ...NONE, medicines: { due: 0, markedTaken: 0, percent: null } }).cards).toEqual([]);
  });

  it("every key it can produce exists in the English catalogue", () => {
    const all = [
      buildWeeklySummary(CFG, { bloodPressure: { readings: bp(4, 120, 80), target: { systolicBelow: 135, diastolicBelow: 85 } }, activity: { activeMinutes: 1, goalMinutes: 2 }, meals: { daysLogged: 1 }, medicines: { due: 5, markedTaken: 4, percent: 80 } }),
      buildWeeklySummary(CFG, { bloodPressure: { readings: bp(1, 120, 80), target: null }, activity: null, meals: { daysLogged: 0 }, medicines: { due: 1, markedTaken: 0, percent: null } }),
      buildWeeklySummary(CFG, { ...NONE, bloodPressure: { readings: bp(4, 120, 80), target: null } }),
    ];
    for (const s of all) for (const c of s.cards) for (const l of [c.title, c.line]) expect(Object.keys(en)).toContain(l.key);
  });

  it("never grades: no weekly line uses a judging word", () => {
    for (const k of Object.keys(en).filter((x) => x.startsWith("weekly."))) {
      expect(en[k as keyof typeof en]).not.toMatch(/\b(good|bad|well done|poor|failed|missed|uncontrolled|normal|abnormal)\b/i);
    }
  });
});
