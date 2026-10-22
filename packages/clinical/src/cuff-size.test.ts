import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { cuffSizeKey, isPlausibleArmCm, parseCuffSizingConfig } from "./cuff-size";

const DIR = new URL("../../../supabase/migrations/", import.meta.url);
const MIGRATION = readFileSync(new URL(readdirSync(DIR).find((f) => f.endsWith("_s07y_cuff_guidance_and_bp_band_report.sql"))!, DIR), "utf8");
const CFG = parseCuffSizingConfig(JSON.parse(/cuff-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(MIGRATION)![1]!));

/** The same parity block the database proof runs through private.bp_cuff_size_key. */
const PROOF = readFileSync(new URL("../../db/tests/s07y_cuff_guidance_and_band_report.sql", import.meta.url), "utf8");
const PARITY = [...(/parity-begin\s*insert into parity values([\s\S]*?);\s*-- parity-end/.exec(PROOF)![1]!).matchAll(/\(([\d.]+), '([a-z_]+)'\)/g)].map((m) => ({
  cm: Number(m[1]),
  expect: m[2]!,
}));

describe("cuff size lookup (S07y)", () => {
  it("agrees with the SQL twin on every parity case", () => {
    expect(PARITY.length).toBeGreaterThanOrEqual(14);
    for (const c of PARITY) expect([c.cm, cuffSizeKey(c.cm, CFG)]).toEqual([c.cm, c.expect]);
  });
  it("rejects a malformed configuration instead of guessing", () => {
    expect(() => parseCuffSizingConfig({})).toThrow();
    expect(() => parseCuffSizingConfig({ sizes: [{ key: "a", minCm: 30, maxCm: 20 }], measureMinCm: 15, measureMaxCm: 60 })).toThrow();
    expect(() => parseCuffSizingConfig({ sizes: [{ key: "a", minCm: 20, maxCm: 30 }], measureMinCm: 60, measureMaxCm: 15 })).toThrow();
  });
  it("treats a measurement outside the plausible range as not a measurement", () => {
    expect(isPlausibleArmCm(14, CFG)).toBe(false);
    expect(isPlausibleArmCm(30, CFG)).toBe(true);
    expect(isPlausibleArmCm(61, CFG)).toBe(false);
    expect(isPlausibleArmCm(Number.NaN, CFG)).toBe(false);
  });
});
