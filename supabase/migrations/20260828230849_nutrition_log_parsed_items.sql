-- Nigerian Nutrition Intelligence — text-based food logging + full nutrition
-- analysis (spec 19.4/19.5), stored alongside the existing photo/AI-vision
-- path on nutrition_log_entries.
--
-- `ai_estimate` (existing) is the photo-vision estimate: carbs/calories only,
-- confidence-scored, from meal-vision.ts. `parsed_items`/`nutrition_analysis`
-- (new, this migration) are the food-database-matched breakdown of the typed
-- `description` text against public.nigerian_foods — independent of whether a
-- photo was attached, and covering the full macro set (calories, carbs,
-- protein, fat, fibre, sodium) where the food was actually matched. Both are
-- coaching telemetry only, same as the rest of this table — never clinical,
-- never fed to patient_risk_scores/escalation, never attributed to a doctor.
--
-- Shapes (produced by apps/web/src/lib/nutrition/food-parser.ts /
-- nutrition-analysis.ts, never trusted from the client — always recomputed
-- server-side in logMealAction from the food catalogue):
--   parsed_items: [{ raw, food_code, food_name, quantity, unit, grams,
--                     matched, confidence }]
--   nutrition_analysis: { calories_kcal, carbs_g, protein_g, fat_g, fibre_g,
--                          sodium_mg, reliable, matched_count, unmatched_count }

alter table public.nutrition_log_entries
  add column if not exists parsed_items jsonb,
  add column if not exists nutrition_analysis jsonb;
