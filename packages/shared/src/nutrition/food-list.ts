import {
  FOOD_COST_TIERS,
  FOOD_PORTION_UNITS,
  NIGERIAN_FOOD_CATEGORIES,
  type FoodCatalogueItem,
  type FoodCostTier,
  type FoodPortionUnit,
  type NigerianFoodCategory,
} from "./catalogue";

/**
 * The food list shipped to the phone so logging works with no signal (v5 6.3, S06 offline). Rows are arrays, not objects, and
 * units/categories are indices, which keeps the JSON roughly a third of the size and gzip does the rest. `version` is a hash of
 * the content, so the phone only downloads again when the catalogue actually changed.
 */
export interface CompactFoodList {
  version: string;
  /** Column names of a row, for the reader's benefit. */
  fields: readonly string[];
  rows: CompactFoodRow[];
}

type CompactPortion = [unit: number, grams: number, isDefault: 0 | 1];
export type CompactFoodRow = [
  code: string,
  name: string,
  aliases: string[],
  category: number,
  costTier: number,
  kcal: number,
  carbs: number,
  protein: number,
  fat: number,
  fibre: number,
  sodiumMg: number,
  sugar: number | null,
  isDrink: 0 | 1,
  portions: CompactPortion[],
];

export const COMPACT_FIELDS = [
  "code", "name", "aliases", "category", "costTier", "kcal", "carbs", "protein", "fat", "fibre", "sodiumMg", "sugar", "isDrink", "portions",
] as const;

/** FNV-1a over the rows: small, deterministic, no crypto needed for a cache key. */
function hashRows(rows: unknown): string {
  const text = JSON.stringify(rows);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function compressFoodList(catalogue: readonly FoodCatalogueItem[]): CompactFoodList {
  const rows: CompactFoodRow[] = [...catalogue]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((f) => [
      f.code,
      f.name,
      f.aliases,
      NIGERIAN_FOOD_CATEGORIES.indexOf(f.category),
      FOOD_COST_TIERS.indexOf(f.costTier),
      f.caloriesKcal100g,
      f.carbsG100g,
      f.proteinG100g,
      f.fatG100g,
      f.fibreG100g,
      f.sodiumMg100g,
      f.sugarG100g ?? null,
      f.isDrink ? 1 : 0,
      f.portions.map((p): CompactPortion => [FOOD_PORTION_UNITS.indexOf(p.unit), p.grams, p.isDefault ? 1 : 0]),
    ]);
  return { version: hashRows(rows), fields: COMPACT_FIELDS, rows };
}

/** Thresholds mirror the generated columns in the database (UK front-of-pack "high" lines). */
export const HIGH_SALT_SODIUM_MG_100G = 600;
export const HIGH_SUGAR_G_100G_FOOD = 22.5;
export const HIGH_SUGAR_G_100G_DRINK = 11.25;

/** Rebuilds catalogue items from a compact list. Rows that do not parse are skipped, never guessed. */
export function expandFoodList(list: CompactFoodList): FoodCatalogueItem[] {
  const out: FoodCatalogueItem[] = [];
  for (const r of list.rows) {
    const category: NigerianFoodCategory | undefined = NIGERIAN_FOOD_CATEGORIES[r[3]];
    const cost: FoodCostTier | undefined = FOOD_COST_TIERS[r[4]];
    if (!category || !cost) continue;
    const portions = r[13]
      .map((p) => ({ unit: FOOD_PORTION_UNITS[p[0]] as FoodPortionUnit | undefined, grams: p[1], isDefault: p[2] === 1 }))
      .filter((p): p is { unit: FoodPortionUnit; grams: number; isDefault: boolean } => p.unit !== undefined);
    const isDrink = r[12] === 1;
    const sugar = r[11];
    out.push({
      id: r[0],
      code: r[0],
      name: r[1],
      aliases: r[2],
      category,
      costTier: cost,
      caloriesKcal100g: r[5],
      carbsG100g: r[6],
      proteinG100g: r[7],
      fatG100g: r[8],
      fibreG100g: r[9],
      sodiumMg100g: r[10],
      sugarG100g: sugar,
      isDrink,
      highSalt: r[10] >= HIGH_SALT_SODIUM_MG_100G,
      highSugar: sugar != null && sugar >= (isDrink ? HIGH_SUGAR_G_100G_DRINK : HIGH_SUGAR_G_100G_FOOD),
      portions,
    });
  }
  return out;
}
