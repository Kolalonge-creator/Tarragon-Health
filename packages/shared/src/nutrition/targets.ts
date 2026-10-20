/**
 * Daily nutrition targets (v5 6.5), as a pure function of a profile and a SIGNED configuration.
 *
 * Safety (spec Module 6 go-live rules):
 *  - a calorie target is never below the configured safe minimum for the person's sex, whatever the formula says;
 *  - no number exists at all unless the database gate (`my_nutrition_target_gate`) handed over a signed configuration. The gate
 *    withholds for pregnancy, the postnatal year, a clinician hold, a positive eating-disorder screen and anyone under 18, and it
 *    gives no reason. Code here never decides that, it only refuses to compute from a configuration that fails validation.
 *  - these are MAINTENANCE estimates (Mifflin-St Jeor). There is no weight-loss target in this module on purpose.
 */

export type ActivityLevel = "low" | "light" | "moderate" | "high";
const ACTIVITY_LEVELS: readonly ActivityLevel[] = ["low", "light", "moderate", "high"];

export interface NutritionTargetConfig {
  min_age_years: number;
  energy: {
    activity_factors: Record<ActivityLevel, number>;
    default_activity: ActivityLevel;
    floor_kcal: { female: number; male: number };
    ceiling_kcal: number;
    round_to_kcal: number;
  };
  macros_pct_of_energy: { carbs: number; protein: number; fat: number };
  salt_sugar_fibre: { sodium_mg_max: number; sugar_pct_of_energy_max: number; fibre_g_per_1000_kcal: number };
  meal_summary: { light_below_kcal: number; heavy_above_kcal: number; salty_above_sodium_mg: number; sugary_above_sugar_g: number };
}

/** A safe minimum below this is refused outright, whatever a configuration says (mirrors the database check). */
export const ABSOLUTE_MIN_FLOOR_KCAL = 1000;
export const ABSOLUTE_MIN_AGE_YEARS = 18;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validates an unknown value (the `config` the gate returns) as a usable configuration, or null. Never throws. */
export function parseNutritionTargetConfig(raw: unknown): NutritionTargetConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const energy = c.energy as Record<string, unknown> | undefined;
  const macros = c.macros_pct_of_energy as Record<string, unknown> | undefined;
  const ssf = c.salt_sugar_fibre as Record<string, unknown> | undefined;
  const ms = c.meal_summary as Record<string, unknown> | undefined;
  if (!energy || !macros || !ssf || !ms) return null;
  const factors = energy.activity_factors as Record<string, unknown> | undefined;
  const floor = energy.floor_kcal as Record<string, unknown> | undefined;
  if (!factors || !floor) return null;
  for (const level of ACTIVITY_LEVELS) if (!isNum(factors[level]) || (factors[level] as number) <= 0) return null;
  if (!isNum(floor.female) || !isNum(floor.male)) return null;
  if (floor.female < ABSOLUTE_MIN_FLOOR_KCAL || floor.male < ABSOLUTE_MIN_FLOOR_KCAL) return null;
  if (!isNum(c.min_age_years) || c.min_age_years < ABSOLUTE_MIN_AGE_YEARS) return null;
  if (!isNum(energy.ceiling_kcal) || !isNum(energy.round_to_kcal) || energy.round_to_kcal <= 0) return null;
  if (!ACTIVITY_LEVELS.includes(energy.default_activity as ActivityLevel)) return null;
  if (!isNum(macros.carbs) || !isNum(macros.protein) || !isNum(macros.fat)) return null;
  if (Math.abs(macros.carbs + macros.protein + macros.fat - 100) > 0.5) return null;
  if (!isNum(ssf.sodium_mg_max) || !isNum(ssf.sugar_pct_of_energy_max) || !isNum(ssf.fibre_g_per_1000_kcal)) return null;
  if (!isNum(ms.light_below_kcal) || !isNum(ms.heavy_above_kcal) || !isNum(ms.salty_above_sodium_mg) || !isNum(ms.sugary_above_sugar_g)) return null;
  if (ms.light_below_kcal >= ms.heavy_above_kcal) return null;
  return raw as NutritionTargetConfig;
}

/**
 * `unavailable` covers "withheld for this person" and "not signed off yet" on purpose: the database answers both the same way so the
 * function cannot be used to learn who is withheld, and the app must not distinguish them either.
 */
export type TargetsGate = { state: "unavailable" } | { state: "ok"; configVersion: number; config: NutritionTargetConfig };

/** Reads the JSON `my_nutrition_target_gate()` returns. Anything unexpected is unavailable: the safe direction. */
export function parseTargetsGate(raw: unknown): TargetsGate {
  if (!raw || typeof raw !== "object") return { state: "unavailable" };
  const g = raw as { state?: unknown; config?: unknown; config_version?: unknown };
  if (g.state !== "ok") return { state: "unavailable" };
  const config = parseNutritionTargetConfig(g.config);
  if (!config || !isNum(g.config_version)) return { state: "unavailable" };
  return { state: "ok", configVersion: g.config_version, config };
}

export interface TargetInputs {
  ageYears: number | null;
  sex: "male" | "female" | null;
  weightKg: number | null;
  heightCm: number | null;
  activity?: ActivityLevel;
}

export interface DailyTargets {
  energyKcal: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fibreG: number;
  sodiumMgMax: number;
  saltGMax: number;
  sugarGMax: number;
}

export type TargetsResult =
  | { status: "ok"; targets: DailyTargets; floorApplied: boolean; ceilingApplied: boolean }
  | { status: "needs_profile"; missing: ("age" | "sex" | "weight" | "height")[] }
  | { status: "too_young" };

const round = (n: number, step: number) => Math.round(n / step) * step;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeDailyTargets(inputs: TargetInputs, config: NutritionTargetConfig): TargetsResult {
  const missing: ("age" | "sex" | "weight" | "height")[] = [];
  if (inputs.ageYears == null || inputs.ageYears <= 0 || inputs.ageYears > 110) missing.push("age");
  if (inputs.sex == null) missing.push("sex");
  if (inputs.weightKg == null || inputs.weightKg < 25 || inputs.weightKg > 300) missing.push("weight");
  if (inputs.heightCm == null || inputs.heightCm < 120 || inputs.heightCm > 230) missing.push("height");
  if (missing.length > 0) return { status: "needs_profile", missing };
  const age = inputs.ageYears as number;
  const sex = inputs.sex as "male" | "female";
  if (age < config.min_age_years) return { status: "too_young" };

  const e = config.energy;
  const bmr = 10 * (inputs.weightKg as number) + 6.25 * (inputs.heightCm as number) - 5 * age + (sex === "male" ? 5 : -161);
  const raw = bmr * e.activity_factors[inputs.activity ?? e.default_activity];
  const floor = e.floor_kcal[sex];
  let energy = round(raw, e.round_to_kcal);
  let floorApplied = false;
  let ceilingApplied = false;
  if (energy < floor) {
    energy = floor;
    floorApplied = true;
  }
  if (energy > e.ceiling_kcal) {
    energy = e.ceiling_kcal;
    ceilingApplied = true;
  }
  // The floor is a hard rule, re-checked here after every adjustment so a future edit above cannot quietly break it.
  if (energy < floor) energy = floor;

  const m = config.macros_pct_of_energy;
  const s = config.salt_sugar_fibre;
  return {
    status: "ok",
    floorApplied,
    ceilingApplied,
    targets: {
      energyKcal: energy,
      carbsG: round1((energy * m.carbs) / 100 / 4),
      proteinG: round1((energy * m.protein) / 100 / 4),
      fatG: round1((energy * m.fat) / 100 / 9),
      fibreG: round1((energy / 1000) * s.fibre_g_per_1000_kcal),
      sodiumMgMax: s.sodium_mg_max,
      saltGMax: round1((s.sodium_mg_max * 2.5) / 1000),
      sugarGMax: round1((energy * s.sugar_pct_of_energy_max) / 100 / 4),
    },
  };
}

export function ageInYears(dateOfBirth: string | null, now: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export interface DayTotals {
  caloriesKcal: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fibreG: number;
  sodiumMg: number;
  sugarG: number;
  /** Entries that had no catalogue-based analysis, so the totals are a floor, not the whole day. */
  uncountedMeals: number;
}

export interface AnalysisLike {
  caloriesKcal?: number;
  carbsG?: number;
  proteinG?: number;
  fatG?: number;
  fibreG?: number;
  sodiumMg?: number;
  sugarG?: number;
}

/** Sums the stored analyses of a day's meals; a meal with none is counted as uncounted rather than as zero. */
export function sumDay(analyses: readonly (AnalysisLike | null | undefined)[]): DayTotals {
  const t: DayTotals = { caloriesKcal: 0, carbsG: 0, proteinG: 0, fatG: 0, fibreG: 0, sodiumMg: 0, sugarG: 0, uncountedMeals: 0 };
  for (const a of analyses) {
    if (!a || typeof a.caloriesKcal !== "number") {
      t.uncountedMeals += 1;
      continue;
    }
    t.caloriesKcal += a.caloriesKcal;
    t.carbsG += a.carbsG ?? 0;
    t.proteinG += a.proteinG ?? 0;
    t.fatG += a.fatG ?? 0;
    t.fibreG += a.fibreG ?? 0;
    t.sodiumMg += a.sodiumMg ?? 0;
    t.sugarG += a.sugarG ?? 0;
  }
  return {
    caloriesKcal: round1(t.caloriesKcal),
    carbsG: round1(t.carbsG),
    proteinG: round1(t.proteinG),
    fatG: round1(t.fatG),
    fibreG: round1(t.fibreG),
    sodiumMg: round1(t.sodiumMg),
    sugarG: round1(t.sugarG),
    uncountedMeals: t.uncountedMeals,
  };
}
