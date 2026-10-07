import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s38c_monthly_report_and_risk_stratification.sql"));
  if (!file) throw new Error("S38c migration not found");
  const re = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`);
  const match = re.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in the migration`);
  return JSON.parse(match[1]);
}

describe("S38c config mirrors the migration seeds", () => {
  it("risk.stratification is identical to the risk_config seed", () => {
    expect(seed("risk-rules")).toEqual(getProposedConfig("risk.stratification").value);
  });

  it("reports.monthly is identical to the monthly_report_config seed", () => {
    expect(seed("monthly-report-rules")).toEqual(getProposedConfig("reports.monthly").value);
  });

  it("the tiers are ordered and every point value is a non-negative integer", () => {
    const v = getProposedConfig("risk.stratification").value as {
      tiers: { medium_min: number; high_min: number };
      points: Record<string, Record<string, number>>;
    };
    expect(v.tiers.medium_min).toBeLessThan(v.tiers.high_min);
    for (const family of Object.values(v.points)) {
      for (const p of Object.values(family)) expect(Number.isInteger(p) && p >= 0).toBe(true);
    }
  });
});
