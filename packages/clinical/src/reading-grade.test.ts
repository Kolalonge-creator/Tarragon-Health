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

interface GradeCase extends ReadingGradeInput { readonly name: string; readonly expected: ReadingGrade }

// ONE case table (reading-grade-cases.json). Jest runs it through gradeBpReading; the SQL proof embeds a copy and runs it through private.bp_reading_grade, and the
// test below fails if the copy in the proof differs from this file.
const CASES: GradeCase[] = JSON.parse(readFileSync(new URL("./reading-grade-cases.json", import.meta.url), "utf8"));
const PROOF = readFileSync(new URL("../../db/tests/w25_measurement_context.sql", import.meta.url), "utf8");

describe("gradeBpReading", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(gradeBpReading(c, GRADE)).toBe(c.expected);
  });

  it("the SQL proof embeds exactly this case table", () => {
    const m = /grade-cases-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(PROOF);
    if (!m?.[1]) throw new Error("grade cases not found in the proof");
    expect(JSON.parse(m[1])).toEqual(CASES);
  });

  it("an unrecorded position is unknown, never C; rest is never assumed", () => {
    expect(gradeBpReading({ systolic: 120, diastolic: 80, position: undefined, restedMinutes: 5, repeatCount: 1 }, GRADE)).toBe("unknown");
    expect(gradeBpReading({ systolic: 120, diastolic: 80, position: "seated", restedMinutes: undefined, repeatCount: 5 }, GRADE)).toBe("rest_not_recorded");
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
