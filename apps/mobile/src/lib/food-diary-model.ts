import { portionUnitLabel, type FoodCatalogueItem, type FoodPortionUnit } from "@tarragon/shared";

/**
 * Pure rules for the food diary on the phone (S49a): searching the on-device food list, building the sentence a picked food adds to a meal,
 * choosing recent meals to offer for a one-tap repeat, and reading the server's targets answer. No I/O, so every branch is unit tested.
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

/** Foods whose name or alias contains the text, shortest name first so "eba" beats "ebaa" matches; at most `limit`. */
export function searchFoods(foods: readonly FoodCatalogueItem[], query: string, limit = 8): FoodCatalogueItem[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return foods
    .filter((f) => f.name.toLowerCase().includes(q) || f.aliases.some((a) => a.toLowerCase().includes(q)))
    .sort((a, b) => a.name.length - b.name.length)
    .slice(0, limit);
}

export function defaultUnit(food: FoodCatalogueItem): FoodPortionUnit {
  return food.portions.find((p) => p.isDefault)?.unit ?? food.portions[0]?.unit ?? "serving";
}

/** "2 wraps of eba": the words a picked food adds to the meal. The server parses them with the same parser the web uses. */
export function foodPhrase(food: FoodCatalogueItem, unit: FoodPortionUnit, quantity: number): string {
  const n = Math.min(20, Math.max(1, Math.round(quantity) || 1));
  return `${n} ${portionUnitLabel(unit, n)} of ${food.name.toLowerCase()}`;
}

export function appendPhrase(description: string, phrase: string, max = 500): string {
  const base = description.trim();
  return (base ? `${base}, ${phrase}` : phrase).slice(0, max);
}

/** Which meal a one-tap log counts as when nothing else says: the Lagos clock (UTC+1, no daylight saving). */
export function mealTypeForLagosHour(now: Date): MealType {
  const hour = new Date(now.getTime() + 60 * 60 * 1000).getUTCHours();
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

export interface DiaryEntryLike {
  id: string;
  mealType: MealType;
  description: string | null;
}

/** Up to `limit` distinct meals (by their words) from newest to oldest. A photo-only meal has no words to repeat and is skipped. */
export function recentDistinctMeals<T extends DiaryEntryLike>(entries: readonly T[], limit = 5): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of entries) {
    const key = (e.description ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length === limit) break;
  }
  return out;
}

export interface MealSummaryLines {
  light_below_kcal: number;
  heavy_above_kcal: number;
  salty_above_sodium_mg: number;
  sugary_above_sugar_g: number;
}

export interface GuidanceTargets {
  energyKcal: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fibreG: number;
  sodiumMgMax: number;
  saltGMax: number;
  sugarGMax: number;
}

export interface GuidanceTotals {
  caloriesKcal: number;
  carbsG: number;
  proteinG: number;
  fatG: number;
  fibreG: number;
  sodiumMg: number;
  sugarG: number;
  uncountedMeals: number;
}

export type Guidance =
  | { state: "hidden" }
  | { state: "needs_profile"; missing: string[]; mode: "numbers" | "words"; mealSummary: MealSummaryLines }
  | { state: "ok"; targets: GuidanceTargets; floorApplied: boolean; totals: GuidanceTotals; mode: "numbers" | "words"; mealSummary: MealSummaryLines };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readSummaryLines(v: unknown): MealSummaryLines | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (!isNum(m.light_below_kcal) || !isNum(m.heavy_above_kcal) || !isNum(m.salty_above_sodium_mg) || !isNum(m.sugary_above_sugar_g)) return null;
  return { light_below_kcal: m.light_below_kcal, heavy_above_kcal: m.heavy_above_kcal, salty_above_sodium_mg: m.salty_above_sodium_mg, sugary_above_sugar_g: m.sugary_above_sugar_g };
}

function readNumbers<K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const n = o[k];
    if (!isNum(n)) return null;
    out[k] = n;
  }
  return out;
}

const TARGET_KEYS = ["energyKcal", "carbsG", "proteinG", "fatG", "fibreG", "sodiumMgMax", "saltGMax", "sugarGMax"] as const;
const TOTAL_KEYS = ["caloriesKcal", "carbsG", "proteinG", "fatG", "fibreG", "sodiumMg", "sugarG", "uncountedMeals"] as const;
/** The server never sends a calorie target below this; the phone refuses to show one anyway if it ever arrives (belt and braces). */
export const NEVER_SHOW_BELOW_KCAL = 1000;

/** Reads the server's answer. Anything unexpected, missing or unsafe is `hidden`: show nothing, say nothing. */
export function parseGuidance(raw: unknown): Guidance {
  if (!raw || typeof raw !== "object") return { state: "hidden" };
  const g = raw as Record<string, unknown>;
  const mode: "numbers" | "words" = g.mode === "words" ? "words" : "numbers";
  const mealSummary = readSummaryLines(g.mealSummary);
  if (g.state === "needs_profile" && mealSummary && Array.isArray(g.missing)) {
    return { state: "needs_profile", missing: g.missing.filter((m): m is string => typeof m === "string"), mode, mealSummary };
  }
  if (g.state === "ok" && mealSummary) {
    const targets = readNumbers(g.targets, TARGET_KEYS);
    const totals = readNumbers(g.totals, TOTAL_KEYS);
    if (!targets || !totals || targets.energyKcal < NEVER_SHOW_BELOW_KCAL) return { state: "hidden" };
    return { state: "ok", targets, totals, floorApplied: g.floorApplied === true, mode, mealSummary };
  }
  return { state: "hidden" };
}
