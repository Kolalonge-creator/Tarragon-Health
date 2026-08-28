"use server";

import type { Json, TablesInsert } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import {
  nutritionLogSchema,
  nutritionConfirmSchema,
  nutritionReferralRequestSchema,
  budgetAlternativeQuerySchema,
} from "@/lib/validation/nutrition";
import { analyzeMealPhoto, isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { fetchFoodCatalogue } from "@/lib/nutrition/food-catalogue-fetch";
import { parseFoodText } from "@/lib/nutrition/food-parser";
import { analyseNutrition, type NutritionAnalysisResult } from "@/lib/nutrition/nutrition-analysis";
import { detectNutritionRisk, RISK_REASON_LABELS } from "@/lib/nutrition/referral-risk";
import { suggestBudgetAlternative } from "@/lib/nutrition/substitutions";

const MEAL_PHOTO_BUCKET = "meal-photos";

export type NutritionActionState =
  | { error?: string; success?: boolean; aiStatus?: "none" | "estimated" | "unavailable" }
  | undefined;

// Explicit return type (rather than left to inference) so "error" in ctx
// narrows ctx.error to a precise string everywhere it's used — with an
// inferred return type here, TS narrows it to `string | undefined` at
// call sites whose own return type is itself an annotated union (a real,
// reproducible TS inference quirk, not a logic error).
async function currentPatient(): Promise<
  | { error: "Not signed in" | "No organisation on file" }
  | { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; organisationId: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" as const };
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" as const };
  return { supabase, userId: user.id, organisationId: profile.organisation_id };
}

function mediaTypeForPath(path: string, fallback: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return fallback || "image/jpeg";
  }
}

/**
 * Log a meal. When a photo path is supplied and the vision model is configured,
 * runs a best-effort estimate (never blocks the log — the entry always saves,
 * with ai_status recording whether the model ran). Coaching telemetry only.
 */
export async function logMealAction(
  _prev: NutritionActionState,
  formData: FormData,
): Promise<NutritionActionState> {
  const raw = Object.fromEntries(formData.entries());
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = nutritionLogSchema.safeParse(cleaned);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { meal_type, description, photo_path } = parsed.data;

  let aiEstimate: Json | null = null;
  let aiStatus: "none" | "estimated" | "unavailable" = "none";

  if (photo_path) {
    if (!isMealVisionConfigured()) {
      aiStatus = "unavailable";
    } else {
      // Patient's own RLS-scoped session may download from their own folder.
      const { data: blob } = await ctx.supabase.storage
        .from(MEAL_PHOTO_BUCKET)
        .download(photo_path);
      if (blob) {
        const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
        const result = await analyzeMealPhoto({
          imageBase64: base64,
          mediaType: mediaTypeForPath(photo_path, blob.type),
          description,
        });
        if (result.ok) {
          aiEstimate = {
            ...result.estimate,
            model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
          } as unknown as Json;
          aiStatus = "estimated";
        } else {
          aiStatus = "unavailable";
        }
      } else {
        aiStatus = "unavailable";
      }
    }
  }

  // Text-based food logging + full nutrition analysis (spec 19.4/19.5) —
  // independent of the photo/AI-vision path above, and recomputed here from
  // the food catalogue every time rather than trusted from the client.
  let parsedItems: Json | null = null;
  let nutritionAnalysis: Json | null = null;
  if (description && description.trim().length > 0) {
    const catalogue = await fetchFoodCatalogue(ctx.supabase);
    if (catalogue.length > 0) {
      const items = parseFoodText(description, catalogue);
      if (items.length > 0) {
        parsedItems = items as unknown as Json;
        const analysis = analyseNutrition(items, catalogue);
        if (analysis) nutritionAnalysis = analysis as unknown as Json;
      }
    }
  }

  const row: TablesInsert<"nutrition_log_entries"> = {
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    meal_type,
    description: description ?? null,
    photo_path: photo_path ?? null,
    ai_estimate: aiEstimate,
    ai_status: aiStatus,
    parsed_items: parsedItems,
    nutrition_analysis: nutritionAnalysis,
  };

  const { error } = await ctx.supabase.from("nutrition_log_entries").insert(row);
  if (error) return { error: error.message };
  return { success: true, aiStatus };
}

/** Patient confirms (and optionally adjusts) an estimate for a logged meal. */
export async function confirmMealAction(
  _prev: NutritionActionState,
  formData: FormData,
): Promise<NutritionActionState> {
  const raw = Object.fromEntries(formData.entries());
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = nutritionConfirmSchema.safeParse(cleaned);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("nutrition_log_entries")
    .update({
      patient_confirmed: true,
      confirmed_carbs_g: parsed.data.confirmed_carbs_g ?? null,
    })
    .eq("id", parsed.data.entry_id)
    .eq("patient_id", ctx.userId);
  if (error) return { error: error.message };
  return { success: true };
}

/**
 * Patient self-requests nutrition professional support (spec 19.11):
 * nutrition risk -> dietitian referral -> consultation -> personalised plan.
 * The reason/risk factors are always computed here from the patient's own
 * active conditions and their last 10 logged meals — never trusted from the
 * client — and this only ever creates a 'requested' row for a human to act
 * on; it never auto-escalates or books anything itself.
 */
export async function requestNutritionReferralAction(
  _prev: NutritionActionState,
  formData: FormData,
): Promise<NutritionActionState> {
  const raw = Object.fromEntries(formData.entries());
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = nutritionReferralRequestSchema.safeParse(cleaned);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const [{ data: carePlans }, { data: recentEntries }] = await Promise.all([
    ctx.supabase
      .from("care_plans")
      .select("condition")
      .eq("patient_id", ctx.userId)
      .eq("status", "active"),
    ctx.supabase
      .from("nutrition_log_entries")
      .select("nutrition_analysis")
      .eq("patient_id", ctx.userId)
      .order("logged_at", { ascending: false })
      .limit(10),
  ]);

  const conditions = Array.from(new Set((carePlans ?? []).map((c) => c.condition)));
  const recentAnalyses = (recentEntries ?? [])
    .map((e) => e.nutrition_analysis as unknown as NutritionAnalysisResult | null)
    .filter((a): a is NutritionAnalysisResult => a != null);

  const risk = detectNutritionRisk(conditions, recentAnalyses);
  const riskReason = risk.reasons.map((r) => RISK_REASON_LABELS[r]).join(" ");
  const reason =
    [parsed.data.note, riskReason].filter((s): s is string => Boolean(s && s.trim())).join(" — ") ||
    "Patient requested nutrition support.";

  const row: TablesInsert<"nutrition_referrals"> = {
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    reason,
    risk_factors: risk.reasons as unknown as Json,
    status: "requested",
  };

  const { error } = await ctx.supabase.from("nutrition_referrals").insert(row);
  if (error) return { error: error.message };
  return { success: true };
}

export type BudgetAlternativeState =
  | { error: string }
  | { notFound: true }
  | { message: string; alternativeFoodCodes: string[] };

/** Budget-aware substitution ask (spec 19.9): "I cannot afford salmon". Not
 * a form action (nothing is persisted) — called directly from the client. */
export async function getBudgetAlternativeAction(foodQuery: string): Promise<BudgetAlternativeState> {
  const parsed = budgetAlternativeQuerySchema.safeParse({ food_query: foodQuery });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const catalogue = await fetchFoodCatalogue(ctx.supabase);
  if (catalogue.length === 0) {
    return { error: "Couldn't load the food list right now — try again shortly." };
  }

  const suggestion = suggestBudgetAlternative(parsed.data.food_query, catalogue);
  if (!suggestion) return { notFound: true };
  return suggestion;
}
