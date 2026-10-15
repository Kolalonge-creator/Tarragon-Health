import { describe, expect, it } from "@jest/globals";
import { buildAdherenceReport } from "./adherence-report";
import { computeWeeklyAdherence, type AdherenceConfig, type AdherenceMedicine } from "./adherence";
import type { DoseLog, ScheduleSpec } from "./types";

const cfg: AdherenceConfig = { windowDays: 7, minDoses: 3, missedAfterMinutes: 120, thresholdPercent: 80 };
const daily: ScheduleSpec = { startDate: null, endDate: null, foodNote: null, kind: "daily", times: ["08:00"] };
// 2026-10-15 12:00 Lagos: the last completed day is the 14th.
const now = Date.parse("2026-10-15T11:00:00Z");
const at = (date: string) => Date.parse(`${date}T08:05:00Z`) - 3600_000;
const taken = (date: string): DoseLog => ({ status: "taken", source: "patient", loggedAtMs: at(date) });
const skipped = (date: string): DoseLog => ({ status: "skipped", source: "patient", loggedAtMs: at(date) });

function med(logs: Record<string, DoseLog[]>, spec: ScheduleSpec = daily): AdherenceMedicine {
  return { id: "m1", spec, logs: new Map(Object.entries(logs)), activeFromMs: 0 };
}

describe("buildAdherenceReport", () => {
  it("gives completed 7-day weeks, newest first, never including today", () => {
    const rows = buildAdherenceReport([med({})], now, cfg, 2);
    expect(rows.map((r) => [r.weekStart, r.weekEnd])).toEqual([
      ["2026-10-08", "2026-10-14"],
      ["2026-10-01", "2026-10-07"],
    ]);
  });
  it("shows skips apart from no record, counts both as not taken, and reports late doses inside marked taken", () => {
    const logs: Record<string, DoseLog[]> = {};
    for (const d of ["08", "09", "10", "11"]) logs[`2026-10-${d}|08:00`] = [taken(`2026-10-${d}`)];
    logs["2026-10-12|08:00"] = [skipped("2026-10-12")];
    logs["2026-10-13|08:00"] = [{ status: "delayed", source: "patient", loggedAtMs: Date.parse("2026-10-13T12:00:00Z") }];
    logs["2026-10-14|08:00"] = [{ status: "not_available", source: "patient", loggedAtMs: at("2026-10-14") }];
    const [w] = buildAdherenceReport([med(logs)], now, cfg, 1);
    expect(w).toEqual({ weekStart: "2026-10-08", weekEnd: "2026-10-14", due: 7, markedTaken: 5, late: 1, skipped: 1, noRecord: 0, couldNotGet: 1, percent: 71 });
  });
  it("shows no percentage under the minimum number of due doses", () => {
    const [w] = buildAdherenceReport([med({}, { ...daily, kind: "weekdays", times: ["08:00"], days: [1, 2] })], now, cfg, 1);
    expect(w?.due).toBe(2);
    expect(w?.percent).toBeNull();
  });
  it("leaves as-needed medicines out", () => {
    const [w] = buildAdherenceReport([med({}, { ...daily, kind: "as_needed", maxPerDay: 4 })], now, cfg, 1);
    expect(w?.due).toBe(0);
  });
  it("counts a late-evening dose of the last day, which the rolling window would still call open", () => {
    const late: ScheduleSpec = { ...daily, times: ["23:00"], windowMinutes: 180 };
    const [w] = buildAdherenceReport([med({}, late)], now, cfg, 1);
    expect(w?.due).toBe(7);
  });
  it("matches the app's weekly figure when the window ends on the same day", () => {
    const logs: Record<string, DoseLog[]> = {};
    for (const d of ["09", "10", "11", "12", "13", "14"]) logs[`2026-10-${d}|08:00`] = [taken(`2026-10-${d}`)];
    const m = med(logs);
    const direct = computeWeeklyAdherence([m], now, cfg, { windowEnd: "2026-10-14" });
    const [w] = buildAdherenceReport([m], now, cfg, 1);
    expect(w?.percent).toBe(direct.percent);
    expect(w?.markedTaken).toBe(direct.taken + direct.late);
  });
});
