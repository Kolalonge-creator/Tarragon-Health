import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import {
  countRepeatReadings, gradeBpReading, isPlausibleBp, isUnderTarget, parseBpTargetConfig, targetFor, targetKindForContext,
  type ReadingGrade, type ReadingGradeInput,
} from "./reading-grade";

// The configuration under test is the migration seed, the same value the registry mirrors.
const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);
const RAW = JSON.parse(
  /bp-target-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(
    readFileSync(new URL(readdirSync(MIGRATIONS).find((f) => f.endsWith("_w25_measurement_context_target_config_stratified_view.sql"))!, MIGRATIONS), "utf8"),
  )![1]!,
);
const UNSIGNED = parseBpTargetConfig(1, false, RAW);
const SIGNED = parseBpTargetConfig(1, true, RAW);
const GRADE = UNSIGNED.grade;

const input = (over: Partial<ReadingGradeInput>): ReadingGradeInput => ({ systolic: 120, diastolic: 80, position: "seated", restedMinutes: 5, repeatCount: 1, ...over });

// The same table is run through private.bp_reading_grade in packages/db/tests/w25_measurement_context.sql. Keep the two in step.
const CASES: ReadonlyArray<readonly [string, ReadingGradeInput, ReadingGrade]> = [
  ["seated, rested 5, repeat", input({}), "A"],
  ["seated, rested 4, repeat", input({ restedMinutes: 4 }), "B"],
  ["seated, rest not recorded, repeat", input({ restedMinutes: null }), "B"],
  ["seated, rested 5, no repeat", input({ repeatCount: 0 }), "B"],
  ["standing", input({ position: "standing" }), "C"],
  ["lying", input({ position: "lying" }), "C"],
  ["position not recorded", input({ position: null }), "C"],
  ["systolic below the plausible floor", input({ systolic: 59, diastolic: 40 }), "C"],
  ["systolic not above diastolic", input({ systolic: 80, diastolic: 120 }), "C"],
  ["diastolic above the plausible ceiling", input({ systolic: 200, diastolic: 161 }), "C"],
];

describe("gradeBpReading", () => {
  it.each(CASES)("%s", (_name, i, want) => {
    expect(gradeBpReading(i, GRADE)).toBe(want);
  });

  it("an implausible reading is C even when everything else is perfect", () => {
    expect(gradeBpReading(input({ systolic: 300, diastolic: 80 }), GRADE)).toBe("C");
  });

  it("plausibility bounds are inclusive", () => {
    expect(isPlausibleBp(60, 30, GRADE)).toBe(true);
    expect(isPlausibleBp(260, 160, GRADE)).toBe(true);
    expect(isPlausibleBp(261, 100, GRADE)).toBe(false);
    expect(isPlausibleBp(120, 120, GRADE)).toBe(false);
  });
});

describe("countRepeatReadings", () => {
  const t = Date.parse("2026-10-27T08:00:00Z");
  const min = (n: number) => t + n * 60_000;
  it("counts readings between the minimum gap and the window, either side", () => {
    expect(countRepeatReadings(t, [min(1), min(-2), min(10)], GRADE)).toBe(3);
  });
  it("does not count the same minute, a reading outside the window, or itself", () => {
    expect(countRepeatReadings(t, [t, min(0.5), min(11), min(-30)], GRADE)).toBe(0);
  });
});

describe("targets", () => {
  it("home contexts use 135/85 and pharmacy and clinic use 140/90", () => {
    expect(targetFor("home_self", UNSIGNED)).toEqual({ systolic: 135, diastolic: 85 });
    expect(targetFor("home_assisted", UNSIGNED)).toEqual({ systolic: 135, diastolic: 85 });
    expect(targetFor("diary", UNSIGNED)).toEqual({ systolic: 135, diastolic: 85 });
    expect(targetFor("pharmacy", UNSIGNED)).toEqual({ systolic: 140, diastolic: 90 });
    expect(targetFor("clinic", UNSIGNED)).toEqual({ systolic: 140, diastolic: 90 });
  });

  it("an unlabelled or unknown context has no target: it is counted, never judged", () => {
    expect(targetKindForContext("unlabelled", UNSIGNED)).toBeNull();
    expect(targetFor("somewhere_else", UNSIGNED)).toBeNull();
    expect(isUnderTarget(110, 70, "unlabelled", SIGNED)).toBeNull();
  });

  it("an unsigned config gives no control figure at all", () => {
    expect(isUnderTarget(110, 70, "home_self", UNSIGNED)).toBeNull();
  });

  it("a signed config judges strictly under both numbers, on the line for that context", () => {
    expect(isUnderTarget(134, 84, "home_self", SIGNED)).toBe(true);
    expect(isUnderTarget(135, 80, "home_self", SIGNED)).toBe(false);
    // 138/88 is under the clinic line but not the home line: home and clinic are never blended
    expect(isUnderTarget(138, 88, "clinic", SIGNED)).toBe(true);
    expect(isUnderTarget(138, 88, "home_self", SIGNED)).toBe(false);
  });

  it("the migration seed ships unsigned and inactive", () => {
    const sql = readFileSync(new URL(readdirSync(MIGRATIONS).find((f) => f.endsWith("_w25_measurement_context_target_config_stratified_view.sql"))!, MIGRATIONS), "utf8");
    expect(/values \(1, false, \$json\$/.test(sql)).toBe(true);
    const seed = /bp-target-config-begin([\s\S]*?)bp-target-config-end/.exec(sql)![1]!;
    expect(seed).not.toMatch(/approved_by|approved_at/);
  });

  it("parse refuses a config with a missing number", () => {
    expect(() => parseBpTargetConfig(1, false, { targets: { home: { systolic: 135 } } })).toThrow();
  });
});
