import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(suffix: string, marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in ${file}`);
  return JSON.parse(match[1]);
}

describe("medicines.prn_limits mirrors the migration seed (S08x, decision C7)", () => {
  it("v1 is identical to the prn_limit_rules v1 seed", () => {
    expect(seed("_s08x_prn_limits.sql", "prn-limits")).toEqual(getProposedConfig("medicines.prn_limits").value);
  });
  it("the bounds are sane and the repeat rule is a real count over a real window", () => {
    const v = getProposedConfig("medicines.prn_limits").value as {
      minGapMinutesBounds: [number, number];
      dailyMaxBounds: [number, number];
      repeatSignal: { flaggedDoses: number; windowDays: number };
    };
    expect(v.minGapMinutesBounds[0]).toBeGreaterThanOrEqual(1);
    expect(v.minGapMinutesBounds[1]).toBeLessThanOrEqual(1440);
    expect(v.dailyMaxBounds[0]).toBeGreaterThanOrEqual(1);
    expect(v.dailyMaxBounds[1]).toBeLessThanOrEqual(24);
    expect(v.repeatSignal.flaggedDoses).toBeGreaterThanOrEqual(2);
    expect(v.repeatSignal.windowDays).toBeGreaterThanOrEqual(1);
  });
  it("is registered as proposed, owned by the CMO, with no defaults for a medicine's own limits", () => {
    const e = getProposedConfig("medicines.prn_limits");
    expect(e.version).toBe(1);
    expect(Object.keys(e.value as object)).not.toContain("defaultMinGapMinutes");
  });
});
