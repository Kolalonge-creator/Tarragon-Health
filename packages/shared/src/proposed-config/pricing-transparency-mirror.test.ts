import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";
import { ANNUAL_DURATION_DAYS, ANNUAL_MONTHS, MAX_NOT_INCLUDED } from "../../../commerce/src/index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");

function read(dir: string, suffix: string): string {
  const file = readdirSync(join(ROOT, dir)).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`${suffix} not found in ${dir}`);
  return readFileSync(join(ROOT, dir, file), "utf8");
}

const cfg = getProposedConfig("pricing.transparency").value as {
  monthly_equivalent: { enabled: boolean; months: number; rounding: string };
  annual_duration_days: { min: number; max: number };
  max_not_included: number;
};

describe("pricing.transparency mirrors the code and the migration", () => {
  it("is proposed and the figures equal the constants the screens use", () => {
    expect(getProposedConfig("pricing.transparency").status).toBe("proposed");
    expect(cfg.monthly_equivalent.months).toBe(ANNUAL_MONTHS);
    expect(cfg.annual_duration_days).toEqual(ANNUAL_DURATION_DAYS);
    expect(cfg.max_not_included).toBe(MAX_NOT_INCLUDED);
  });

  it("the monthly equivalent is OFF until the founder confirms it", () => {
    expect(cfg.monthly_equivalent.enabled).toBe(false);
    expect(cfg.monthly_equivalent.rounding).toBe("half_up_whole_naira");
  });

  it("the database allows the same number of not-included rows", () => {
    const sql = read("supabase/migrations", "_wp1_pricing_transparency.sql");
    expect(sql).toContain(`>= ${cfg.max_not_included} then`);
    expect(sql).toContain(`cardinality(v_codes) + v_labels > ${cfg.max_not_included}`);
  });

  it("every label key the migration seeds has words in English", () => {
    const sql = read("supabase/migrations", "_wp1_pricing_transparency.sql");
    const en = read("packages/i18n/src", "en.ts");
    const keys = [...sql.matchAll(/'(catalog\.notincl\.[a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(en).toContain(`"${k}":`);
  });

  it("monthly billing is not offered anywhere in this config", () => {
    expect(JSON.stringify(cfg).toLowerCase()).not.toMatch(/instal|per_month_payment|subscription/);
  });
});
