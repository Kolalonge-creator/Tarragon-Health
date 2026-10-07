import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s58_rewards_foundation.sql"));
if (!file) throw new Error("S58 foundation migration not found");
const sql = readFileSync(join(MIGRATIONS, file), "utf8");

function configSeed(key: string): unknown {
  const m = new RegExp(`\\('${key}', 1, \\$json\\$(.*?)\\$json\\$::jsonb`, "s").exec(sql);
  if (!m?.[1]) throw new Error(`reward_config seed ${key} not found`);
  return JSON.parse(m[1]);
}
function ruleSeed(): Array<Record<string, unknown>> {
  const m = /rewards-rules-begin[\s\S]*?\$json\$(\[[\s\S]*?\])\$json\$/.exec(sql);
  if (!m?.[1]) throw new Error("rule seed not found");
  return JSON.parse(m[1]) as Array<Record<string, unknown>>;
}

describe("rewards.* configuration mirrors the reward_config seeds", () => {
  for (const k of ["plausible_ranges", "daily_points_cap", "minor_age_years", "tiers", "streak_grace", "leaderboards", "redemption", "employer_aggregate"]) {
    it(k, () => expect(configSeed(k)).toEqual(getProposedConfig(`rewards.${k}`).value));
  }

  it("points_redemption_cap_kobo is 0 in the database seed and the registry: redemption is off until the founder sets it", () => {
    expect(configSeed("points_redemption_cap_kobo")).toBe(0);
    expect(getProposedConfig("rewards.points_redemption_cap_kobo").value).toBe(0);
  });

  it("rules mirror the migration seed (without the admin-facing description)", () => {
    const seeded = ruleSeed().map((r) => {
      const { description: _d, ...rest } = r;
      return rest;
    });
    expect(seeded).toEqual(getProposedConfig("rewards.rules").value);
  });

  it("leaderboards are off, and every value is proposed and unsigned", () => {
    expect((getProposedConfig("rewards.leaderboards").value as { enabled: boolean }).enabled).toBe(false);
    for (const k of ["rules", "plausible_ranges", "daily_points_cap", "minor_age_years", "tiers", "streak_grace", "leaderboards", "redemption", "employer_aggregate", "points_redemption_cap_kobo"]) {
      expect(getProposedConfig(`rewards.${k}`).status).toBe("proposed");
    }
  });

  it("the redemption share is a percentage of the price: the registry holds no points-to-kobo rate", () => {
    const redemption = getProposedConfig("rewards.redemption").value as Record<string, number>;
    expect(Object.keys(redemption).sort()).toEqual(["max_share_bps", "min_points", "points_per_percent"]);
    const all = JSON.stringify(getProposedConfig("rewards.rules").value) + JSON.stringify(redemption);
    expect(all).not.toMatch(/kobo_per_point|points_to_kobo|kobo_rate/);
  });

  it("no rule references weight, BMI or any body metric, in code, trigger event or caps", () => {
    const body = /(^|[^a-z])(weight|bmi|waist|hip|hips|obes[a-z]*|calor[a-z]*|kcal|kg|lbs|pounds|slim|lean|body|fat|size|shape|thin|inches)([^a-z]|$)/i;
    for (const r of getProposedConfig("rewards.rules").value as Array<Record<string, unknown>>) {
      expect(String(r.code)).not.toMatch(body);
      expect(String(r.trigger_event)).not.toMatch(body);
      expect(JSON.stringify(r.caps ?? {})).not.toMatch(body);
    }
    // the SQL regex is the same pattern: it must be the one the migration uses
    expect(sql).toContain(body.source.replace(/\\/g, "\\"));
  });

  it("every rule is a fixed reward (no chance-based reward for anyone, so none for a minor)", () => {
    expect(sql).toContain("reward_kind = 'fixed'");
    for (const r of getProposedConfig("rewards.rules").value as Array<Record<string, unknown>>) {
      expect(r.reward_kind ?? "fixed").toBe("fixed");
    }
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith("database.types.ts")) out.push(full);
  }
  return out;
}

describe("repo scan: points are never money in application code", () => {
  const files = [...walk(join(ROOT, "apps", "web", "src")), ...walk(join(ROOT, "apps", "mobile", "src")), ...walk(join(ROOT, "supabase", "functions"))];

  it("scans a meaningful number of files", () => expect(files.length).toBeGreaterThan(200));

  it("no app or edge code carries a points-to-money rate or calls the disabled redemption RPC", () => {
    const bad = /(points_to_kobo|pointsToKobo|kobo_per_point|koboPerPoint|redeem_wellness_points)/;
    const hits = files.filter((f) => bad.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.replace(ROOT, ""))).toEqual([]);
  });

  it("the scan discriminates: a sabotaged snippet is caught", () => {
    expect(/(points_to_kobo|pointsToKobo|kobo_per_point|koboPerPoint|redeem_wellness_points)/.test("const kobo = points * pointsToKobo")).toBe(true);
  });

  it("no migration after the S58 foundation calls the legacy unguarded award function", () => {
    const later = readdirSync(MIGRATIONS).filter((f) => f > (file as string) && f.endsWith(".sql"));
    const hits = later.filter((f) => /award_wellness_points\(/.test(readFileSync(join(MIGRATIONS, f), "utf8")));
    expect(hits).toEqual([]);
  });
});
