import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function migrationSql(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("directory.investigation_search mirrors search_investigations", () => {
  it("the SQL function takes the threshold from its caller, with no default written in SQL", () => {
    const sql = migrationSql("_diag_p1_investigation_catalogue_and_search.sql");
    const signature = /function public\.search_investigations\(([^)]*)\)/.exec(sql)?.[1] ?? "";
    expect(signature).toMatch(/p_min_score numeric(?!\s+default)/);
  });

  it("the DB proof exercises the value in force", () => {
    const proof = readFileSync(join(ROOT, "packages", "db", "tests", "diag_p1_investigation_search.sql"), "utf8");
    const value = /t numeric := ([0-9.]+);/.exec(proof)?.[1];
    expect(Number(value)).toBe(getProposedConfig<{ min_score: number }>("directory.investigation_search").value.min_score);
  });
});

describe("directory.diagnostic_cadence mirrors diagnostic_directory_settings v1", () => {
  it("the seeded rules equal the config entry", () => {
    const sql = migrationSql("_diag_p2_listings_services_credentials_eligibility.sql");
    const block = /diag-settings-v1-begin([\s\S]*?)diag-settings-v1-end/.exec(sql)?.[1] ?? "";
    const json = /'(\{[^']*\})'::jsonb/.exec(block)?.[1];
    expect(json).toBeDefined();
    expect(JSON.parse(json ?? "{}")).toEqual(getProposedConfig("directory.diagnostic_cadence").value);
  });
});

describe("directory.diagnostic_search mirrors search_diagnostic_services", () => {
  const sql = migrationSql("_diag_p3_search_diagnostic_services.sql");
  const signature = /function public\.search_diagnostic_services\(([\s\S]*?)\)\s*returns/.exec(sql)?.[1] ?? "";
  const config = getProposedConfig<{ radii_km: number[]; default_radius_km: number; page_size: number }>("directory.diagnostic_search").value;

  it("radius and page size have no default written in SQL", () => {
    expect(signature).toMatch(/p_radius_km\s+numeric\s*,/);
    expect(signature).toMatch(/p_limit\s+integer\s*,/);
  });

  it("every configured value fits inside what the SQL accepts", () => {
    expect(config.radii_km).toContain(config.default_radius_km);
    for (const r of config.radii_km) expect(r > 0 && r <= 1000).toBe(true);
    expect(config.page_size >= 1 && config.page_size <= 50).toBe(true);
  });
});
