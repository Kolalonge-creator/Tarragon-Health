import { z } from "zod";
import type { Enums } from "@tarragon/shared";

/** Meal types — mirror the DB enum public.meal_type. */
export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

// Compile-time guard: keep this list in lockstep with the DB enum.
const _mealTypeCheck: readonly Enums<"meal_type">[] = MEAL_TYPES;
void _mealTypeCheck;

export const MEAL_TYPE_LABELS: Record<(typeof MEAL_TYPES)[number], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

/**
 * Logging a meal. The photo is uploaded to the private `meal-photos` bucket
 * client-side first; only its storage path reaches the server action. Both the
 * description and photo are optional — a patient can log a meal with just a type.
 */
export const nutritionLogSchema = z.object({
  meal_type: z.enum(MEAL_TYPES),
  description: z.string().trim().max(500).nullish(),
  // '<uuid>/<uuid>.<ext>' — the caller's own-folder storage path. Never trusted
  // for auth (storage RLS + the DB insert policy enforce ownership); just recorded.
  photo_path: z.string().trim().max(300).nullish(),
});
export type NutritionLogInput = z.infer<typeof nutritionLogSchema>;

/** Patient confirms an estimate, optionally overriding the carb figure. */
export const nutritionConfirmSchema = z.object({
  entry_id: z.string().uuid(),
  confirmed_carbs_g: z.coerce.number().min(0).max(2000).nullish(),
});
export type NutritionConfirmInput = z.infer<typeof nutritionConfirmSchema>;
