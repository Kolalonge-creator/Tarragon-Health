import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesInsert } from "@tarragon/shared";
import { fetchFoodCatalogue } from "./food-catalogue-fetch";
import type { FoodCatalogueItem } from "./food-catalogue";
import { parseFoodText } from "./food-parser";
import { analyseNutrition } from "./nutrition-analysis";
import { recordWeeklyPlanProgress } from "@/lib/lifestyle/weekly-plan-progress";

/**
 * The one way a meal reaches the diary (web log, one-tap repeat, favourites, the phone's outbox, barcode). The nutrition numbers are
 * ALWAYS recomputed here from the description and the food table, never trusted from a client, which is also why a favourite or a
 * repeated meal stores text only.
 */
export interface MealAnalysis {
  parsedItems: Json | null;
  nutritionAnalysis: Json | null;
}

export function analyseDescriptionWith(description: string | null | undefined, catalogue: readonly FoodCatalogueItem[]): MealAnalysis {
  if (!description || description.trim().length === 0 || catalogue.length === 0) return { parsedItems: null, nutritionAnalysis: null };
  const items = parseFoodText(description, catalogue);
  if (items.length === 0) return { parsedItems: null, nutritionAnalysis: null };
  const analysis = analyseNutrition(items, catalogue);
  return { parsedItems: items as unknown as Json, nutritionAnalysis: analysis ? (analysis as unknown as Json) : null };
}

export async function analyseDescription(supabase: SupabaseClient<Database>, description: string | null | undefined): Promise<MealAnalysis> {
  if (!description || description.trim().length === 0) return { parsedItems: null, nutritionAnalysis: null };
  return analyseDescriptionWith(description, await fetchFoodCatalogue(supabase));
}

export interface InsertMealInput {
  mealType: Database["public"]["Enums"]["meal_type"];
  description?: string | null;
  photoPath?: string | null;
  aiEstimate?: Json | null;
  aiStatus?: "none" | "estimated" | "unavailable";
  analysis?: MealAnalysis;
  /** Minted on the phone; a retried send with the same id is reported as a duplicate, not a second meal. */
  clientId?: string | null;
  clientRecordedAt?: string | null;
  source?: Database["public"]["Enums"]["record_source"];
}

export type InsertMealResult = { ok: true; id: string | null; duplicate: boolean } | { ok: false; error: string };

export async function insertMeal(
  supabase: SupabaseClient<Database>,
  ctx: { userId: string; organisationId: string },
  input: InsertMealInput,
): Promise<InsertMealResult> {
  const analysis = input.analysis ?? (await analyseDescription(supabase, input.description));
  const row: TablesInsert<"nutrition_log_entries"> = {
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    meal_type: input.mealType,
    description: input.description ?? null,
    photo_path: input.photoPath ?? null,
    ai_estimate: input.aiEstimate ?? null,
    ai_status: input.aiStatus ?? "none",
    parsed_items: analysis.parsedItems,
    nutrition_analysis: analysis.nutritionAnalysis,
    client_id: input.clientId ?? null,
    client_recorded_at: input.clientRecordedAt ?? null,
    source: input.source ?? "patient",
  };
  const { data, error } = await supabase.from("nutrition_log_entries").insert(row).select("id").maybeSingle();
  if (error) {
    // 23505 on (patient_id, client_id): this exact send already landed. That is success, not a second meal.
    if (error.code === "23505" && input.clientId) return { ok: true, id: null, duplicate: true };
    return { ok: false, error: error.message };
  }

  // Bridges into the Weekly Plan card's own completion tracking, a no-op without an active diet goal. Best effort by design.
  await recordWeeklyPlanProgress(supabase, {
    patientId: ctx.userId,
    organisationId: ctx.organisationId,
    metric: "food_log",
    valueJson: { meal_type: input.mealType },
    unit: "check",
  });
  return { ok: true, id: data?.id ?? null, duplicate: false };
}
