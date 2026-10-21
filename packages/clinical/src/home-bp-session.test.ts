import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { parseHomeBpConfig, type HomeBpReading } from "./home-bp";
import { planSession } from "./home-bp-session";

// The configuration under test is the one value the registry and the migration seed share (the same trick home-bp.test.ts uses).
const RAW = JSON.parse(
  /home-bp-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(
    readFileSync(new URL("../../../supabase/migrations/" + readdirSync(new URL("../../../supabase/migrations/", import.meta.url)).find((f) => f.endsWith("_s07x_home_bp_programme.sql"))!, import.meta.url), "utf8"),
  )![1]!,
);
const CFG = parseHomeBpConfig(1, RAW);

// Lagos is UTC+1. 2026-10-12 07:00 Lagos = 06:00Z (inside the morning window [4,12)); 19:00 Lagos = 18:00Z (evening [17,24)).
const at = (iso: string): number => Date.parse(iso);
const rd = (iso: string, s = 130, d = 84): HomeBpReading => ({ systolic: s, diastolic: d, atMs: at(iso) });

describe("planSession: where a person is inside one morning or evening session", () => {
  it("outside both windows: says which one comes next", () => {
    // 03:00 Lagos is before the morning window opens
    expect(planSession({ readings: [], nowMs: at("2026-10-12T02:00:00Z") }, CFG)).toEqual({ kind: "outside_window", next: "morning" });
    // 14:00 Lagos is between the windows
    expect(planSession({ readings: [], nowMs: at("2026-10-12T13:00:00Z") }, CFG)).toEqual({ kind: "outside_window", next: "evening" });
  });

  it("after the last window closes, the next one is the morning (windows configured to end before midnight)", () => {
    const cfg = parseHomeBpConfig(1, { ...RAW, protocol: { ...RAW.protocol, eveningHours: [17, 22] } });
    expect(planSession({ readings: [], nowMs: at("2026-10-12T22:30:00Z") }, cfg)).toEqual({ kind: "outside_window", next: "morning" });
  });

  it("no reading yet: rest first, for the configured time", () => {
    expect(planSession({ readings: [], nowMs: at("2026-10-12T06:00:00Z") }, CFG)).toEqual({
      kind: "rest",
      part: "morning",
      number: 1,
      of: CFG.protocol.readingsPerSession,
      restMinutes: CFG.protocol.restMinutes,
    });
  });

  it("a reading from another day or the other window does not count toward this session", () => {
    const readings = [rd("2026-10-11T06:00:00Z"), rd("2026-10-12T18:00:00Z")];
    expect(planSession({ readings, nowMs: at("2026-10-12T06:00:00Z") }, CFG).kind).toBe("rest");
  });

  it("a reading just saved: wait out the gap, counting down in whole seconds", () => {
    const r = [rd("2026-10-12T06:00:00Z")];
    expect(planSession({ readings: r, nowMs: at("2026-10-12T06:00:20Z") }, CFG)).toEqual({ kind: "wait", part: "morning", number: 2, of: 2, secondsLeft: 40 });
    expect(planSession({ readings: r, nowMs: at("2026-10-12T06:00:59.500Z") }, CFG)).toEqual({ kind: "wait", part: "morning", number: 2, of: 2, secondsLeft: 1 });
  });

  it("the gap has passed: take the next reading", () => {
    const r = [rd("2026-10-12T06:00:00Z")];
    expect(planSession({ readings: r, nowMs: at("2026-10-12T06:01:00Z") }, CFG)).toEqual({ kind: "next", part: "morning", number: 2, of: 2 });
    expect(planSession({ readings: r, nowMs: at("2026-10-12T06:08:00Z") }, CFG)).toEqual({ kind: "next", part: "morning", number: 2, of: 2 });
  });

  it("a reading dated after now (a phone clock that was wrong when it was saved) is not part of the session, so it can never hold anyone on a wait", () => {
    const r = [rd("2026-10-12T06:05:00Z")];
    expect(planSession({ readings: r, nowMs: at("2026-10-12T06:00:00Z") }, CFG)).toMatchObject({ kind: "rest", part: "morning" });
    // and a good reading beside it still counts
    const both = [rd("2026-10-12T05:59:30Z"), rd("2026-10-12T06:05:00Z")];
    expect(planSession({ readings: both, nowMs: at("2026-10-12T06:00:00Z") }, CFG)).toMatchObject({ kind: "wait", number: 2, secondsLeft: 30 });
  });

  it("a save made twice (closer than the gap) is one reading, not two", () => {
    const r = [rd("2026-10-12T06:00:00Z"), rd("2026-10-12T06:00:10Z")];
    expect(planSession({ readings: r, nowMs: at("2026-10-12T06:00:30Z") }, CFG)).toMatchObject({ kind: "wait", number: 2 });
  });

  it("all readings saved: done, with their mean (rounded) and the count", () => {
    const r = [rd("2026-10-12T06:00:00Z", 140, 90), rd("2026-10-12T06:01:30Z", 131, 83)];
    expect(planSession({ readings: r, nowMs: at("2026-10-12T06:02:00Z") }, CFG)).toEqual({ kind: "done", part: "morning", readings: 2, mean: { systolic: 136, diastolic: 87 } });
  });

  it("the evening session is independent of the morning one", () => {
    const r = [rd("2026-10-12T06:00:00Z"), rd("2026-10-12T06:02:00Z")];
    expect(planSession({ readings: r, nowMs: at("2026-10-12T18:00:00Z") }, CFG)).toMatchObject({ kind: "rest", part: "evening" });
  });

  it("no gap configured: the next reading is never made to wait", () => {
    const cfg = parseHomeBpConfig(1, { ...RAW, protocol: { ...RAW.protocol, minGapMinutes: 0 } });
    const r = [rd("2026-10-12T06:00:00Z")];
    expect(planSession({ readings: r, nowMs: at("2026-10-12T06:00:00Z") }, cfg)).toMatchObject({ kind: "next", number: 2 });
  });

  it("three readings a session works the same way", () => {
    const cfg = parseHomeBpConfig(1, { ...RAW, protocol: { ...RAW.protocol, readingsPerSession: 3 } });
    const two = [rd("2026-10-12T06:00:00Z"), rd("2026-10-12T06:02:00Z")];
    expect(planSession({ readings: two, nowMs: at("2026-10-12T06:03:30Z") }, cfg)).toEqual({ kind: "next", part: "morning", number: 3, of: 3 });
  });
});
