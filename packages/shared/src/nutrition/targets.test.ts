import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "../proposed-config/index";
import {
  ageInYears,
  computeDailyTargets,
  parseNutritionTargetConfig,
  parseTargetsGate,
  sumDay,
  type NutritionTargetConfig,
} from "./targets";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/** The configuration exactly as the migration seeds it (the unsigned PROPOSED v1). */
function seededConfig(): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s49a_food_logging_foundation.sql"));
  if (!file) throw new Error("S49a migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /nutrition-target-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("nutrition_target_config seed not found in the migration");
  return JSON.parse(match[1]);
}

const config = parseNutritionTargetConfig(seededConfig()) as NutritionTargetConfig;

describe("the seeded configuration", () => {
  it("is valid and carries the safe floors", () => {
    expect(config).not.toBeNull();
    expect(config.energy.floor_kcal).toEqual({ female: 1200, male: 1500 });
  });
});

describe("registry mirror", () => {
  it("the proposed-config entry equals the migration seed", () => {
    expect(getProposedConfig("nutrition.daily_targets").value).toEqual(seededConfig());
  });
});

describe("parseNutritionTargetConfig", () => {
  type Loose = { min_age_years: number; energy: { floor_kcal: { female: number } }; macros_pct_of_energy: { fat: number }; meal_summary?: unknown };
  const clone = () => JSON.parse(JSON.stringify(seededConfig())) as Loose;

  it("refuses a floor below the absolute minimum, even if a configuration asks for it", () => {
    const c = clone();
    c.energy.floor_kcal.female = 800;
    expect(parseNutritionTargetConfig(c)).toBeNull();
  });
  it("refuses a minimum age under 18", () => {
    const c = clone();
    c.min_age_years = 16;
    expect(parseNutritionTargetConfig(c)).toBeNull();
  });
  it("refuses macros that do not add up to 100", () => {
    const c = clone();
    c.macros_pct_of_energy.fat = 40;
    expect(parseNutritionTargetConfig(c)).toBeNull();
  });
  it("refuses non-objects and missing sections", () => {
    expect(parseNutritionTargetConfig(null)).toBeNull();
    expect(parseNutritionTargetConfig("x")).toBeNull();
    const c = clone();
    delete c.meal_summary;
    expect(parseNutritionTargetConfig(c)).toBeNull();
  });
});

describe("parseTargetsGate", () => {
  it("treats anything unexpected as withheld", () => {
    expect(parseTargetsGate(null)).toEqual({ state: "withheld" });
    expect(parseTargetsGate({ state: "weird" })).toEqual({ state: "withheld" });
    expect(parseTargetsGate({ state: "ok", config_version: 1, config: { energy: {} } })).toEqual({ state: "withheld" });
  });
  it("passes through not_active and a valid ok", () => {
    expect(parseTargetsGate({ state: "not_active" })).toEqual({ state: "not_active" });
    const ok = parseTargetsGate({ state: "ok", config_version: 3, config: seededConfig() });
    expect(ok.state).toBe("ok");
    if (ok.state === "ok") expect(ok.configVersion).toBe(3);
  });
  it("a withheld gate carries no numbers", () => {
    expect(Object.keys(parseTargetsGate({ state: "withheld", config: seededConfig() }))).toEqual(["state"]);
  });
});

describe("computeDailyTargets", () => {
  it("computes a maintenance estimate (Mifflin-St Jeor, light activity)", () => {
    // 10*70 + 6.25*170 - 5*40 - 161 = 1401.5; x 1.375 = 1927 -> 1930
    const r = computeDailyTargets({ ageYears: 40, sex: "female", weightKg: 70, heightCm: 170 }, config);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.targets.energyKcal).toBe(1930);
    expect(r.floorApplied).toBe(false);
    expect(r.targets.sodiumMgMax).toBe(2000);
    expect(r.targets.saltGMax).toBe(5);
    expect(r.targets.carbsG).toBeCloseTo((1930 * 0.5) / 4, 0);
    expect(r.targets.fibreG).toBeCloseTo(1.93 * 14, 0);
    expect(r.targets.sugarGMax).toBeCloseTo((1930 * 0.1) / 4, 0);
  });

  it("never goes below the safe minimum: a small, older, inactive woman is raised to the floor and told so", () => {
    const r = computeDailyTargets({ ageYears: 80, sex: "female", weightKg: 40, heightCm: 145, activity: "low" }, config);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.targets.energyKcal).toBe(1200);
    expect(r.floorApplied).toBe(true);
  });

  it("applies the higher male floor", () => {
    const r = computeDailyTargets({ ageYears: 85, sex: "male", weightKg: 45, heightCm: 150, activity: "low" }, config);
    expect(r.status === "ok" && r.targets.energyKcal).toBe(1500);
  });

  it("holds the floor for every combination in a sweep (property)", () => {
    for (const sex of ["male", "female"] as const)
      for (const age of [18, 30, 55, 80, 100])
        for (const weightKg of [30, 45, 60, 90, 150])
          for (const heightCm of [130, 150, 170, 190])
            for (const activity of ["low", "light", "moderate", "high"] as const) {
              const r = computeDailyTargets({ ageYears: age, sex, weightKg, heightCm, activity }, config);
              if (r.status !== "ok") throw new Error("expected ok");
              expect(r.targets.energyKcal).toBeGreaterThanOrEqual(config.energy.floor_kcal[sex]);
              expect(r.targets.energyKcal).toBeLessThanOrEqual(config.energy.ceiling_kcal);
            }
  });

  it("refuses under 18 even with a good profile", () => {
    expect(computeDailyTargets({ ageYears: 17, sex: "female", weightKg: 55, heightCm: 160 }, config)).toEqual({ status: "too_young" });
  });

  it("asks for the missing profile fields instead of guessing", () => {
    const r = computeDailyTargets({ ageYears: null, sex: null, weightKg: null, heightCm: 170 }, config);
    expect(r).toEqual({ status: "needs_profile", missing: ["age", "sex", "weight"] });
  });

  it("treats an implausible weight or height as missing", () => {
    const r = computeDailyTargets({ ageYears: 40, sex: "male", weightKg: 5, heightCm: 20 }, config);
    expect(r).toEqual({ status: "needs_profile", missing: ["weight", "height"] });
  });
});

describe("ageInYears", () => {
  it("counts whole years and handles a birthday not yet reached", () => {
    expect(ageInYears("1980-06-15", new Date("2026-06-14T12:00:00Z"))).toBe(45);
    expect(ageInYears("1980-06-15", new Date("2026-06-15T12:00:00Z"))).toBe(46);
    expect(ageInYears(null)).toBeNull();
    expect(ageInYears("nonsense")).toBeNull();
  });
});

describe("sumDay", () => {
  it("adds the stored analyses and counts a meal with none as uncounted, not zero", () => {
    const t = sumDay([{ caloriesKcal: 500, sodiumMg: 300, sugarG: 4 }, null, { caloriesKcal: 250.5, carbsG: 10 }, {}]);
    expect(t.caloriesKcal).toBe(750.5);
    expect(t.sodiumMg).toBe(300);
    expect(t.sugarG).toBe(4);
    expect(t.uncountedMeals).toBe(2);
  });
});
