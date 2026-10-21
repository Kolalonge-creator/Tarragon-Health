import type { NutritionTargetConfig } from "./targets";

/**
 * Simple per-meal summary for people who do not want numbers (v5 6.7).
 *
 * The answer is always WORDS ("light", "balanced", "heavy"), never colour alone, so it reads the same to a screen reader and to
 * someone who cannot tell colours apart. It is shown only when the database gate allows targets for this person (the same
 * withholding as the calorie targets: pregnancy, clinician hold, and so on), because calling a meal "heavy" is exactly the kind
 * of message that must not reach those people. Thresholds come from the signed configuration, never from here.
 */
export type MealWord = "light" | "balanced" | "heavy";
export type MealNote = "salty" | "sugary";

export interface MealSummaryInput {
  caloriesKcal: number;
  sodiumMg: number;
  sugarG?: number;
  /** False when some of what was typed could not be matched to the food list. */
  reliable: boolean;
}

export interface MealSummary {
  word: MealWord;
  notes: MealNote[];
  /** True when the meal was only partly counted. */
  partial: boolean;
  /** Plain-English sentence, ready to show. */
  text: string;
}

export function summariseMeal(input: MealSummaryInput, config: NutritionTargetConfig["meal_summary"]): MealSummary {
  const word: MealWord =
    input.caloriesKcal < config.light_below_kcal ? "light" : input.caloriesKcal > config.heavy_above_kcal ? "heavy" : "balanced";
  const notes: MealNote[] = [];
  if (input.sodiumMg > config.salty_above_sodium_mg) notes.push("salty");
  if ((input.sugarG ?? 0) > config.sugary_above_sugar_g) notes.push("sugary");
  const partial = !input.reliable;
  const noteText = notes.length > 0 ? `, and a bit ${notes.join(" and ")}` : "";
  const lead = `A ${word} meal${noteText}.`;
  return { word, notes, partial, text: partial ? `${lead} This is based on part of what you entered.` : lead };
}
