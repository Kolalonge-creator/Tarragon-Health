/**
 * Nigerian food reference set used to GROUND the meal-photo vision model.
 *
 * US barcode databases and portion models are useless for Nigerian food, so we
 * give the model a compact anchor list of common dishes with rough typical
 * carbohydrate loads. These figures are DELIBERATELY approximate — the feature
 * is coaching telemetry, never a clinical measurement — and exist only to keep
 * the model's estimates in a sane range for local staples it might otherwise
 * misjudge. Pure module (no server-only, no network) so it is unit-testable.
 */

export interface NigerianFoodRef {
  name: string;
  aliases?: string[];
  /** Rough carbohydrate grams for a typical home serving. Approximate. */
  typicalCarbsPerServingG: number;
  note?: string;
}

export const NIGERIAN_FOOD_REFERENCE: readonly NigerianFoodRef[] = [
  { name: "Jollof rice", aliases: ["party rice"], typicalCarbsPerServingG: 55, note: "1 medium plate" },
  { name: "White rice and stew", aliases: ["rice and stew"], typicalCarbsPerServingG: 55 },
  { name: "Fried rice", typicalCarbsPerServingG: 52 },
  { name: "Eba", aliases: ["garri", "gari"], typicalCarbsPerServingG: 60, note: "1 medium wrap" },
  { name: "Pounded yam", aliases: ["iyan"], typicalCarbsPerServingG: 62 },
  { name: "Amala", typicalCarbsPerServingG: 50 },
  { name: "Fufu", aliases: ["akpu"], typicalCarbsPerServingG: 58 },
  { name: "Semovita", aliases: ["semo", "semolina"], typicalCarbsPerServingG: 58 },
  { name: "Boiled yam", typicalCarbsPerServingG: 45 },
  { name: "Fried plantain", aliases: ["dodo"], typicalCarbsPerServingG: 40 },
  { name: "Boiled plantain", typicalCarbsPerServingG: 42 },
  { name: "Beans", aliases: ["ewa", "cowpea"], typicalCarbsPerServingG: 38 },
  { name: "Moi moi", aliases: ["moin moin", "moimoi"], typicalCarbsPerServingG: 22 },
  { name: "Akara", aliases: ["bean cake"], typicalCarbsPerServingG: 18 },
  { name: "Egusi soup", typicalCarbsPerServingG: 8, note: "eaten with a swallow" },
  { name: "Efo riro", aliases: ["vegetable soup"], typicalCarbsPerServingG: 7 },
  { name: "Okra soup", aliases: ["okro soup"], typicalCarbsPerServingG: 9 },
  { name: "Egusi and vegetables", typicalCarbsPerServingG: 9 },
  { name: "Pepper soup", typicalCarbsPerServingG: 6 },
  { name: "Suya", aliases: ["spiced grilled meat"], typicalCarbsPerServingG: 4 },
  { name: "Pap", aliases: ["ogi", "akamu", "custard"], typicalCarbsPerServingG: 30 },
  { name: "Bread", aliases: ["agege bread"], typicalCarbsPerServingG: 30, note: "2 slices" },
  { name: "Indomie", aliases: ["noodles"], typicalCarbsPerServingG: 54 },
  { name: "Yam porridge", aliases: ["asaro"], typicalCarbsPerServingG: 48 },
  { name: "Ofada rice", typicalCarbsPerServingG: 55 },
  { name: "Tuwo", aliases: ["tuwo shinkafa", "tuwo masara"], typicalCarbsPerServingG: 58 },
] as const;

/**
 * A compact, prompt-friendly summary of the reference set. Fed into the vision
 * system prompt so the model anchors local staples to sane carb ranges.
 */
export function summariseFoodReference(): string {
  return NIGERIAN_FOOD_REFERENCE.map((f) => {
    const alias = f.aliases?.length ? ` (also: ${f.aliases.join(", ")})` : "";
    return `${f.name}${alias}: ~${f.typicalCarbsPerServingG}g carbs/serving`;
  }).join("; ");
}

/**
 * S49a: the same grounding, read from the food table (`nigerian_foods`) instead of the hand-kept list above, so the photo model
 * knows every dish the diary knows (about 108 today, not 26). The hand-kept list stays as the fallback when the table cannot be
 * read: the photo estimate must keep working with no catalogue.
 *
 * Carbs for a typical serving = carbs per 100 g x the food's DEFAULT portion in grams. Estimates, like the table itself, which is
 * flagged for dietitian review; still coaching telemetry, never a clinical measurement.
 */
export interface CatalogueReferenceFood {
  name: string;
  aliases: readonly string[];
  carbsG100g: number;
  portions: readonly { grams: number; isDefault: boolean }[];
}

export function summariseCatalogueReference(catalogue: readonly CatalogueReferenceFood[]): string {
  const parts: string[] = [];
  for (const f of catalogue) {
    const portion = f.portions.find((p) => p.isDefault) ?? f.portions[0];
    if (!portion) continue;
    const carbs = Math.round((f.carbsG100g * portion.grams) / 100);
    const alias = f.aliases.length ? ` (also: ${f.aliases.slice(0, 3).join(", ")})` : "";
    parts.push(`${f.name}${alias}: ~${carbs}g carbs/serving`);
  }
  return parts.join("; ");
}

/** The grounding text for the photo prompt: the table when it gave us foods, else the hand-kept list. */
export function foodGroundingText(catalogue?: readonly CatalogueReferenceFood[] | null): string {
  if (catalogue && catalogue.length >= 20) {
    const text = summariseCatalogueReference(catalogue);
    if (text.length > 0) return text;
  }
  return summariseFoodReference();
}
