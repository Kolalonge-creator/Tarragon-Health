import { describe, expect, it } from "@jest/globals";
import { computeWeeklyAdherence, groupLogsBySlot, type AdherenceConfig, type AdherenceMedicine } from "./adherence";
import type { DoseLog, ScheduleSpec } from "./types";

const cfg: AdherenceConfig = { windowDays: 7, minDoses: 3, missedAfterMinutes: 120, thresholdPercent: 80 };
const base = { startDate: null, endDate: null, foodNote: null } as const;
const daily: ScheduleSpec = { ...base, kind: "daily", times: ["08:00"] };
// 2026-10-07 12:00 Lagos
const now = Date.parse("2026-10-07T11:00:00Z");
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`) - 3600_000;
const taken = (date: string): DoseLog => ({ status: "taken", source: "patient", loggedAtMs: at(date, "08:05") });

function med(logs: Record<string, DoseLog[]>, spec: ScheduleSpec = daily, activeFromMs = 0): AdherenceMedicine {
  return { id: "m1", spec, logs: new Map(Object.entries(logs)), activeFromMs };
}

describe("computeWeeklyAdherence", () => {
  it("counts a full week of taken doses as 100 and not below threshold", () => {
    const logs: Record<string, DoseLog[]> = {};
    for (const d of ["01", "02", "03", "04", "05", "06", "07"]) logs[`2026-10-${d}|08:00`] = [taken(`2026-10-${d}`)];
    const r = computeWeeklyAdherence([med(logs)], now, cfg);
    expect(r).toMatchObject({ percent: 100, due: 7, taken: 7, missed: 0, belowThreshold: false, windowStart: "2026-10-01", windowEnd: "2026-10-07" });
  });
  it("counts missed (derived from the clock) against the percentage", () => {
    const logs = { "2026-10-05|08:00": [taken("2026-10-05")], "2026-10-06|08:00": [taken("2026-10-06")], "2026-10-07|08:00": [taken("2026-10-07")] };
    const r = computeWeeklyAdherence([med(logs)], now, cfg);
    expect(r).toMatchObject({ due: 7, taken: 3, missed: 4, percent: 43, belowThreshold: true });
  });
  it("treats a dose taken late as taken, and reports it", () => {
    const late: DoseLog = { status: "delayed", source: "patient", loggedAtMs: at("2026-10-05", "13:00") };
    const logs = { "2026-10-05|08:00": [late], "2026-10-06|08:00": [taken("2026-10-06")], "2026-10-07|08:00": [taken("2026-10-07")] };
    const r = computeWeeklyAdherence([med(logs, { ...daily, startDate: "2026-10-05" })], now, cfg);
    expect(r).toMatchObject({ taken: 2, late: 1, due: 3, percent: 100 });
  });
  it("a late-synced taken beats the server's missed for the same slot", () => {
    const missed: DoseLog = { status: "missed", source: "system", loggedAtMs: at("2026-10-05", "20:00") };
    const logs = { "2026-10-05|08:00": [missed, taken("2026-10-05")], "2026-10-06|08:00": [taken("2026-10-06")], "2026-10-07|08:00": [taken("2026-10-07")] };
    const r = computeWeeklyAdherence([med(logs, { ...daily, startDate: "2026-10-05" })], now, cfg);
    expect(r).toMatchObject({ taken: 3, missed: 0, percent: 100 });
  });
  it("reports skipped and unavailable apart from missed, and they are not taken", () => {
    const skipped: DoseLog = { status: "skipped", source: "patient", loggedAtMs: at("2026-10-05", "08:10") };
    const na: DoseLog = { status: "not_available", source: "patient", loggedAtMs: at("2026-10-06", "08:10") };
    const logs = { "2026-10-05|08:00": [skipped], "2026-10-06|08:00": [na], "2026-10-07|08:00": [taken("2026-10-07")] };
    const r = computeWeeklyAdherence([med(logs, { ...daily, startDate: "2026-10-05" })], now, cfg);
    expect(r).toMatchObject({ skipped: 1, unavailable: 1, missed: 0, taken: 1, due: 3, percent: 33 });
  });
  it("does not count a dose still inside its due window, or one not yet due", () => {
    const early = Date.parse("2026-10-07T07:30:00Z"); // 08:30 Lagos, dose at 08:00 is due, window open
    const r = computeWeeklyAdherence([med({}, { ...daily, startDate: "2026-10-06" })], early, cfg);
    expect(r.due).toBe(1);
    const evening = med({}, { ...base, kind: "daily", times: ["20:00"], startDate: "2026-10-07" });
    expect(computeWeeklyAdherence([evening], now, cfg).due).toBe(0);
  });
  it("does not count slots due before the medicine was added", () => {
    const logs = { "2026-10-06|08:00": [taken("2026-10-06")], "2026-10-07|08:00": [taken("2026-10-07")] };
    const addedAfter0805 = Date.parse("2026-10-05T12:00:00Z"); // 13:00 Lagos on the 5th
    const r = computeWeeklyAdherence([med(logs, { ...daily, startDate: "2026-10-04" }, addedAfter0805)], now, { ...cfg, minDoses: 2 });
    expect(r).toMatchObject({ due: 2, taken: 2, percent: 100 });
  });
  it("says nothing when fewer than the minimum doses were due", () => {
    const r = computeWeeklyAdherence([med({}, { ...daily, startDate: "2026-10-07" })], now, cfg);
    expect(r).toMatchObject({ percent: null, belowThreshold: false });
  });
  it("ignores as-needed medicines and pools several medicines", () => {
    const prn: ScheduleSpec = { ...base, kind: "as_needed", maxPerDay: 2 };
    const r = computeWeeklyAdherence([med({}, prn), med({ "2026-10-07|08:00": [taken("2026-10-07")] }, { ...daily, startDate: "2026-10-06" })], now, cfg);
    expect(r.due).toBe(2);
    expect(computeWeeklyAdherence([], now, cfg).due).toBe(0);
  });
  it("buckets the window by Lagos day, not the phone's day", () => {
    const justAfterMidnightLagos = Date.parse("2026-10-07T23:30:00Z"); // 00:30 on the 8th in Lagos
    expect(computeWeeklyAdherence([], justAfterMidnightLagos, cfg).windowEnd).toBe("2026-10-08");
  });
  it("is exactly at the threshold not below it", () => {
    const logs: Record<string, DoseLog[]> = {};
    for (const d of ["01", "02", "03", "04"]) logs[`2026-10-${d}|08:00`] = [taken(`2026-10-${d}`)];
    const r = computeWeeklyAdherence([med(logs, { ...daily, startDate: "2026-10-01", endDate: "2026-10-05" })], now, { ...cfg, windowDays: 7 });
    expect(r.percent).toBe(80);
    expect(r.belowThreshold).toBe(false);
  });
});

describe("flexible windows in the weekly count", () => {
  it("does not count a dose as missed while its window is still open", () => {
    // now is 12:00 Lagos; the 08:00 dose has a 6 hour window, so it is open until 14:00
    const open = med({}, { ...daily, startDate: "2026-10-07", windowMinutes: 360 });
    expect(computeWeeklyAdherence([open], now, { ...cfg, minDoses: 1 }).due).toBe(0);
    const exact = med({}, { ...daily, startDate: "2026-10-07" });
    expect(computeWeeklyAdherence([exact], now, { ...cfg, minDoses: 1 }).missed).toBe(1);
  });
});

describe("groupLogsBySlot", () => {
  it("groups rows of the same slot and keeps different slots apart", () => {
    const m = groupLogsBySlot([
      { date: "2026-10-05", time: "08:00", status: "missed", source: "system", loggedAtMs: 2 },
      { date: "2026-10-05", time: "08:00", status: "taken", source: "patient", loggedAtMs: 1 },
      { date: "2026-10-06", time: "08:00", status: "taken", source: "patient", loggedAtMs: 3 },
    ]);
    expect(m.get("2026-10-05|08:00")).toHaveLength(2);
    expect(m.get("2026-10-06|08:00")).toHaveLength(1);
    expect(m.get("2026-10-05|08:00")![0]).toEqual({ status: "missed", source: "system", loggedAtMs: 2 });
  });
});
