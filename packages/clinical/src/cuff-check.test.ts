import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { classifyPair, evaluateCuffCheck, homeMeanAround, pairDifference, parseCuffCheckConfig } from "./cuff-check";

// The configuration under test is the one value the registry and the migration seed share.
const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);
const RAW = JSON.parse(
  /cuff-check-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(
    readFileSync(new URL(readdirSync(MIGRATIONS).find((f) => f.endsWith("_s07y_home_cuff_vs_clinic_check.sql"))!, MIGRATIONS), "utf8"),
  )![1]!,
);
const CFG = parseCuffCheckConfig(1, RAW);
const ms = (iso: string) => Date.parse(iso);

/** The parity block lives in the database proof, so the SQL and TypeScript rules are held to the very same cases. */
const PARITY = JSON.parse(
  /parity-begin\s*insert into parity values \(\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(new URL("../../db/tests/s07y_cuff_check.sql", import.meta.url), "utf8"))![1]!,
) as {
  classify: { name: string; ds: number; dd: number; expect: string }[];
  homeMean: { name: string; clinicAt: string; readings: { s: number; d: number; at: string }[]; expect: { systolic: number; diastolic: number; count: number } | null }[];
  check: { name: string; now: string; pairs: { at: string; ds: number; dd: number }[]; expect: { kind: string | null; pairsUsed: number; matching: number } }[];
};

describe("cuff check: parity with the SQL rules (same cases as the database proof)", () => {
  it("has a meaningful number of cases", () => {
    expect(PARITY.classify.length).toBeGreaterThanOrEqual(8);
    expect(PARITY.homeMean.length).toBeGreaterThanOrEqual(6);
    expect(PARITY.check.length).toBeGreaterThanOrEqual(14);
  });
  for (const c of PARITY.classify) {
    it(`classify: ${c.name}`, () => {
      expect(classifyPair({ dSys: c.ds, dDia: c.dd }, CFG)).toBe(c.expect);
    });
  }
  for (const c of PARITY.homeMean) {
    it(`home mean: ${c.name}`, () => {
      const got = homeMeanAround(c.readings.map((r) => ({ systolic: r.s, diastolic: r.d, atMs: ms(r.at) })), ms(c.clinicAt), CFG);
      expect(got).toEqual(c.expect);
    });
  }
  for (const c of PARITY.check) {
    it(`check: ${c.name}`, () => {
      expect(evaluateCuffCheck(c.pairs.map((p) => ({ atMs: ms(p.at), dSys: p.ds, dDia: p.dd })), ms(c.now), CFG)).toEqual(c.expect);
    });
  }
});

describe("cuff check: small rules", () => {
  it("a pair difference is own minus clinic", () => {
    expect(pairDifference({ systolic: 142, diastolic: 90 }, { systolic: 128, diastolic: 78 }, 5)).toEqual({ atMs: 5, dSys: 14, dDia: 12 });
  });
  it("does not depend on the order the pairs arrive in", () => {
    const pairs = [
      { atMs: ms("2026-10-10T10:00:00Z"), dSys: 15, dDia: 8 },
      { atMs: ms("2026-10-14T10:00:00Z"), dSys: 11, dDia: 2 },
      { atMs: ms("2026-10-12T10:00:00Z"), dSys: 14, dDia: 7 },
    ];
    const now = ms("2026-10-20T00:00:00Z");
    expect(evaluateCuffCheck([...pairs].reverse(), now, CFG)).toEqual(evaluateCuffCheck(pairs, now, CFG));
  });
  it("breaks a tie on the same instant by the values (the database sorts the same way)", () => {
    const at = ms("2026-10-10T10:00:00Z");
    const pairs = [
      { atMs: at, dSys: 1, dDia: 1 },
      { atMs: at, dSys: 12, dDia: 1 },
      { atMs: at, dSys: 12, dDia: 6 },
      { atMs: at, dSys: 13, dDia: 6 },
    ];
    const r = evaluateCuffCheck(pairs, ms("2026-10-20T00:00:00Z"), CFG);
    expect(r.pairsUsed).toBe(4);
    expect(r.kind).toBe("home_higher");
    expect(r.matching).toBe(3);
  });
  it("two directions that both reach the bar raise nothing (only possible with a loose share, never with the signed one)", () => {
    const loose = { ...CFG, consistency: { ...CFG.consistency, minSharePercent: 51, minPairs: 2, maxPairs: 4 } };
    const pairs = [
      { atMs: ms("2026-10-10T10:00:00Z"), dSys: 15, dDia: 8 },
      { atMs: ms("2026-10-11T10:00:00Z"), dSys: 15, dDia: 8 },
      { atMs: ms("2026-10-12T10:00:00Z"), dSys: -15, dDia: -8 },
      { atMs: ms("2026-10-13T10:00:00Z"), dSys: -15, dDia: -8 },
    ];
    // 2 of 4 is 50 percent, below 51: nothing; with a share of 50 both would qualify and the rule must still refuse to pick one
    expect(evaluateCuffCheck(pairs, ms("2026-10-20T00:00:00Z"), loose).kind).toBeNull();
    const tie = { ...loose, consistency: { ...loose.consistency, minSharePercent: 50 } };
    expect(evaluateCuffCheck(pairs, ms("2026-10-20T00:00:00Z"), tie).kind).toBeNull();
  });
});

describe("cuff check: loading the configuration", () => {
  it("parses the seed", () => {
    expect(CFG.version).toBe(1);
    expect(CFG.difference).toEqual({ systolic: 10, diastolic: 5 });
    expect(CFG.consistency).toEqual({ minPairs: 3, maxPairs: 5, lookbackDays: 365, minSharePercent: 75 });
    expect(CFG.pairing).toEqual({ windowHours: 24, minHomeReadings: 2 });
    expect(CFG.tasks.reviewDueMinutes).toBe(10080);
  });
  it("refuses a value that is not an object, a missing section and a bad number", () => {
    expect(() => parseCuffCheckConfig(1, null)).toThrow(/must be an object/);
    expect(() => parseCuffCheckConfig(1, [])).toThrow(/must be an object/);
    expect(() => parseCuffCheckConfig(1, { ...RAW, pairing: undefined })).toThrow(/pairing must be an object/);
    expect(() => parseCuffCheckConfig(1, { ...RAW, difference: { systolic: 0, diastolic: 5 } })).toThrow(/difference.systolic/);
    expect(() => parseCuffCheckConfig(1, { ...RAW, difference: { systolic: 10.5, diastolic: 5 } })).toThrow(/whole number/);
    expect(() => parseCuffCheckConfig(1, { ...RAW, difference: { systolic: "10", diastolic: 5 } })).toThrow(/whole number/);
  });
  it("refuses a configuration that contradicts itself", () => {
    expect(() => parseCuffCheckConfig(1, { ...RAW, consistency: { ...RAW.consistency, minPairs: 4, maxPairs: 3 } })).toThrow(/maxPairs cannot be below/);
    expect(() => parseCuffCheckConfig(1, { ...RAW, consistency: { ...RAW.consistency, minSharePercent: 101 } })).toThrow(/minSharePercent/);
    expect(() => parseCuffCheckConfig(1, { ...RAW, pairing: { ...RAW.pairing, windowHours: 3_000_000_000 } })).toThrow(/windowHours/);
    expect(() => parseCuffCheckConfig(1, { ...RAW, consistency: { ...RAW.consistency, minSharePercent: 50 } })).toThrow(/minSharePercent/);
    expect(() => parseCuffCheckConfig(1, { ...RAW, consistency: { ...RAW.consistency, minPairs: 1 } })).toThrow(/minPairs/);
  });
});
