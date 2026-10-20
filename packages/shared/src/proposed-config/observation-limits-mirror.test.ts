import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";
import { checkObservation, observationLimit, observationRangeMessageKey, type ObservationLimitKey } from "../observation-limits";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("observations.plausibility mirrors the S47a migration and stays proposed", () => {
  const sql = migration("_s47a_b_observation_types_limits_inhaler_and_signoff.sql");

  it("is identical to the observation_limit_signoffs version 1 seed", () => {
    const match = /observation-limits-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("observation limits seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("observations.plausibility").value);
    expect(getProposedConfig("observations.plausibility").version).toBe(1);
    expect(getProposedConfig("observations.plausibility").status).toBe("proposed");
  });

  it("ships unsigned and inactive: the seed row is inserted with is_active false and no approver", () => {
    expect(/values \(1, false, \$json\$/.test(sql)).toBe(true);
    const block = /observation-limits-begin([\s\S]*?)observation-limits-end/.exec(sql)![1]!;
    expect(block).not.toMatch(/approved_by|approved_at/);
  });

  it("the database CHECK uses the same hard limits as the config for the lifestyle types", () => {
    const water = observationLimit("water_ml");
    const sleep = observationLimit("sleep_hours");
    const mood = observationLimit("mood");
    expect(sql).toContain(`'water_ml'    then value_numeric between ${water.min} and ${water.max}`);
    expect(sql).toContain(`'sleep_hours' then value_numeric between ${sleep.min} and ${sleep.max}`);
    expect(sql).toContain(`else                    value_numeric between ${mood.min} and ${mood.max}`);
    const puffs = observationLimit("inhaler_puffs");
    expect(sql).toContain(`check (puffs between ${puffs.min} and ${puffs.max})`);
    expect(sql).toContain(`create table public.inhaler_use_logs`);
  });

  it("the module the migration creates is born off", () => {
    expect(sql).toMatch(/insert into public\.platform_modules \(key, label, description\) values\s+\('extended_observations'/);
    const insert = /insert into public\.platform_modules[\s\S]*?on conflict/.exec(sql)![0];
    expect(insert).not.toContain("is_enabled");
  });
});

describe("checkObservation", () => {
  it("rejects an implausible glucose in either unit, and accepts the emergency values the red-flag engine must see", () => {
    expect(checkObservation("glucose_mmol_l", 0.4)).toEqual({ ok: false, reason: "out_of_range" });
    expect(checkObservation("glucose_mmol_l", 45)).toEqual({ ok: false, reason: "out_of_range" });
    expect(checkObservation("glucose_mg_dl", 5)).toEqual({ ok: false, reason: "out_of_range" });
    // a true severe low and a crisis-range high are enterable
    expect(checkObservation("glucose_mmol_l", 1.5)).toEqual({ ok: true, warn: null });
    expect(checkObservation("glucose_mmol_l", 35)).toEqual({ ok: true, warn: null });
  });

  it("is a typo gate, not a clinical band: a crisis blood pressure and a low pulse pass", () => {
    expect(checkObservation("systolic_mmhg", 250).ok).toBe(true);
    expect(checkObservation("pulse_bpm", 30).ok).toBe(true);
    expect(checkObservation("spo2_pct", 65).ok).toBe(true);
  });

  it("refuses NaN, Infinity and a fractional whole-number type", () => {
    expect(checkObservation("water_ml", Number.NaN)).toEqual({ ok: false, reason: "not_a_number" });
    expect(checkObservation("water_ml", Infinity)).toEqual({ ok: false, reason: "not_a_number" });
    expect(checkObservation("mood", 2.5)).toEqual({ ok: false, reason: "not_whole" });
    expect(checkObservation("spo2_pct", 97.5)).toEqual({ ok: false, reason: "not_whole" });
  });

  it("soft limits warn but never refuse", () => {
    expect(checkObservation("water_ml", 2000)).toEqual({ ok: true, warn: "unusually_high" });
    expect(checkObservation("water_ml", 250)).toEqual({ ok: true, warn: null });
    expect(checkObservation("sleep_hours", 1)).toEqual({ ok: true, warn: "unusually_low" });
    expect(checkObservation("sleep_hours", 20)).toEqual({ ok: true, warn: "unusually_high" });
    expect(checkObservation("inhaler_puffs", 12)).toEqual({ ok: true, warn: "unusually_high" });
  });

  it("every limit key has a translation key shaped observation.range.<key>", () => {
    const all = getProposedConfig("observations.plausibility").value as Record<string, unknown>;
    for (const k of Object.keys(all)) expect(observationRangeMessageKey(k as ObservationLimitKey)).toBe(`observation.range.${k}`);
  });

  it("still resolves when the device clock is before the config's effective date", () => {
    const real = Date.now;
    Date.now = () => new Date("2020-01-01T00:00:00Z").getTime();
    try {
      expect(observationLimit("water_ml").max).toBe(3000);
    } finally {
      Date.now = real;
    }
  });
});
