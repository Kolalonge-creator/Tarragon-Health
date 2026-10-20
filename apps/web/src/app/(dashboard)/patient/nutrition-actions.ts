"use server";

import type { Json, TablesInsert } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import {
  nutritionLogSchema,
  nutritionConfirmSchema,
  nutritionReferralRequestSchema,
  budgetAlternativeQuerySchema,
  mealPlanRequestSchema,
  favouriteMealSchema,
  mealSummaryModeSchema,
  entryIdSchema,
  barcodeCodeSchema,
} from "@/lib/validation/nutrition";
import { analyzeMealPhoto, isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { AI_SYSTEMS, runGovernedAi } from "@/lib/ai-governance";
import { fetchFoodCatalogue } from "@/lib/nutrition/food-catalogue-fetch";
import type { NutritionAnalysisResult } from "@/lib/nutrition/nutrition-analysis";
import { detectNutritionRisk, RISK_REASON_LABELS } from "@/lib/nutrition/referral-risk";
import { suggestBudgetAlternative } from "@/lib/nutrition/substitutions";
import { generateMealPlan, type MealPlanGenerationResult } from "@/lib/nutrition/meal-plan-generate";
import { insertMeal, analyseDescriptionWith } from "@/lib/nutrition/meal-log";
import { loadNutritionGuidance, type NutritionGuidance } from "@/lib/nutrition/guidance";
import { parseBarcodeLookup, isValidGtin, normaliseBarcode, type BarcodeLookup } from "@tarragon/shared";

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

  // One read of the food table serves both the photo grounding (AI-008) and the text analysis below. Best effort: an empty list
  // means the photo prompt falls back to its hand-kept reference and the text is simply not analysed.
  const catalogue = await fetchFoodCatalogue(ctx.supabase);

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
        const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

        // AI-008. The estimate is indicative and feeds no clinical threshold,
        // so the fallback is simply logging the meal without one — which is
        // the ai_status = "unavailable" state this action already had.
        const governed = await runGovernedAi<Json | null>({
          supabase: ctx.supabase,
          systemCode: AI_SYSTEMS.mealPhotoNutrition.code,
          inputCategory: "meal_photo",
          subjectProfileId: ctx.userId,
          run: async () => {
            const result = await analyzeMealPhoto({
              imageBase64: base64,
              mediaType: mediaTypeForPath(photo_path, blob.type),
              description,
              catalogue,
            });
            return {
              value: result.ok ? ({ ...result.estimate, model } as unknown as Json) : null,
              modelIdentifier: model,
              outputSummary: result.ok ? "meal nutrition estimated" : "photo not estimated",
              resultingAction: result.ok ? "nutrition_estimate_attached" : "no_estimate",
            };
          },
          fallback: () => null,
        });

        if (governed.value) {
          aiEstimate = governed.value;
          aiStatus = "estimated";
        } else {
          aiStatus = "unavailable";
        }
      } else {
        aiStatus = "unavailable";
      }
    }
  }

  // Text-based food logging + full nutrition analysis (spec 19.4/19.5): independent of the photo path above, recomputed here from the
  // food table every time rather than trusted from the client.
  const inserted = await insertMeal(ctx.supabase, ctx, {
    mealType: meal_type,
    description: description ?? null,
    photoPath: photo_path ?? null,
    aiEstimate,
    aiStatus,
    analysis: analyseDescriptionWith(description, catalogue),
  });
  if (!inserted.ok) return { error: inserted.error };

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
    [parsed.data.note, riskReason].filter((s): s is string => Boolean(s && s.trim())).join("; ") ||
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
    return { error: "Couldn't load the food list right now. Try again shortly." };
  }

  const suggestion = suggestBudgetAlternative(parsed.data.food_query, catalogue);
  if (!suggestion) return { notFound: true };
  return suggestion;
}

export type MealPlanActionState =
  | { status: "error"; error: string }
  | { status: "ckd_not_offered" }
  | { status: "generated" }
  | undefined;

/**
 * Generate (or regenerate) a 7-day meal plan (spec 19.8). Each call inserts
 * a new, immutable nutrition_meal_plans row — regenerating never edits an
 * old one. Conditions are read fresh from care_plans every time, never
 * trusted from the client, and CKD is refused before any AI call is even
 * attempted (see meal-plan-generate.ts's own defence-in-depth check too).
 */
export async function generateMealPlanAction(
  _prev: MealPlanActionState,
  formData: FormData,
): Promise<MealPlanActionState> {
  const raw = Object.fromEntries(formData.entries());
  const cleaned = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]),
  );
  const parsed = mealPlanRequestSchema.safeParse(cleaned);
  if (!parsed.success) {
    return { status: "error", error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const ctx = await currentPatient();
  if ("error" in ctx) return { status: "error", error: ctx.error };

  const { data: carePlans } = await ctx.supabase
    .from("care_plans")
    .select("condition")
    .eq("patient_id", ctx.userId)
    .eq("status", "active");
  const conditions = Array.from(new Set((carePlans ?? []).map((c) => c.condition)));

  if (conditions.includes("ckd")) {
    return { status: "ckd_not_offered" };
  }

  const catalogue = await fetchFoodCatalogue(ctx.supabase);
  if (catalogue.length === 0) {
    return { status: "error", error: "Couldn't load the food list right now. Try again shortly." };
  }

  // AI-011. Generation is a governed call; the CKD refusal and catalogue
  // checks above are deterministic gates and stay outside it. The fallback
  // mirrors "unavailable" — a state generateMealPlanAction already handles.
  const governed = await runGovernedAi<MealPlanGenerationResult>({
    supabase: ctx.supabase,
    systemCode: AI_SYSTEMS.mealPlanGeneration.code,
    inputCategory: "meal_plan_request",
    subjectProfileId: ctx.userId,
    run: async () => {
      const generated = await generateMealPlan({
        catalogue,
        conditions,
        budgetTier: parsed.data.budget_tier ?? null,
        preferencesNote: parsed.data.preferences_note ?? null,
      });
      return {
        value: generated,
        modelIdentifier: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
        outputSummary: generated.ok
          ? `generated a ${generated.plan.days.length}-day meal plan`
          : `not generated: ${generated.reason}`,
        resultingAction: generated.ok ? "meal_plan_generated" : "no_plan_generated",
      };
    },
    fallback: () => ({ ok: false, reason: "unavailable" }) as MealPlanGenerationResult,
  });
  const result = governed.value;

  const basePlanRow = {
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    conditions: conditions as unknown as Json,
    budget_tier: parsed.data.budget_tier ?? null,
    preferences_note: parsed.data.preferences_note ?? null,
  };

  if (!result.ok) {
    // ckd_not_offered never reaches here (returned above), so this is only
    // ever 'unavailable' (no API key) or 'error' (timeout/malformed output).
    if (result.reason !== "unavailable") {
      await ctx.supabase.from("nutrition_meal_plans").insert({
        ...basePlanRow,
        plan: null,
        ai_status: "failed",
        error_message: "Generation failed or timed out.",
      });
    }
    return {
      status: "error",
      error:
        result.reason === "unavailable"
          ? "Meal plan generation isn't switched on yet."
          : "Couldn't generate a plan right now. Please try again.",
    };
  }

  const { error } = await ctx.supabase.from("nutrition_meal_plans").insert({
    ...basePlanRow,
    plan: result.plan as unknown as Json,
    ai_status: "generated",
  });
  if (error) return { status: "error", error: error.message };
  return { status: "generated" };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// S49a: one-tap repeat, favourites, summary mode, targets, barcode
// ---------------------------------------------------------------------------------------------------------------------------------

/** Which meal a one-tap log counts as when the saved meal has no type of its own: by the Lagos clock. */
function mealTypeForLagosHour(now: Date): "breakfast" | "lunch" | "dinner" | "snack" {
  const hour = new Date(now.getTime() + 60 * 60 * 1000).getUTCHours();
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

/**
 * Log a recent meal again, in one action: no form, no second screen. The description is re-read from the patient's OWN entry under RLS
 * and the numbers are recomputed from the food table, so a repeated meal is never a stale copy of old maths. A photo is not copied
 * (it belonged to that meal); a photo-only meal repeats its estimate, unconfirmed.
 */
export async function repeatMealAction(entryId: string): Promise<NutritionActionState> {
  const parsed = entryIdSchema.safeParse({ entry_id: entryId });
  if (!parsed.success) return { error: "That meal could not be found." };
  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { data: entry, error: readError } = await ctx.supabase
    .from("nutrition_log_entries")
    .select("meal_type, description, ai_estimate")
    .eq("id", parsed.data.entry_id)
    .eq("patient_id", ctx.userId)
    .maybeSingle();
  if (readError) return { error: "We could not read that meal. Please try again." };
  if (!entry) return { error: "That meal could not be found." };
  const hasText = Boolean(entry.description && entry.description.trim().length > 0);
  if (!hasText && !entry.ai_estimate) return { error: "There is nothing in that meal to repeat." };

  const inserted = await insertMeal(ctx.supabase, ctx, {
    mealType: entry.meal_type,
    description: entry.description,
    aiEstimate: hasText ? null : (entry.ai_estimate as Json),
    aiStatus: hasText ? "none" : "estimated",
  });
  if (!inserted.ok) return { error: inserted.error };
  return { success: true };
}

export type FavouriteActionState = { error?: string; success?: boolean } | undefined;

/** Save a meal under a name. Either typed fresh, or taken from a logged entry (entry_id) so "save this" is one tap and a name. */
export async function saveFavouriteAction(_prev: FavouriteActionState, formData: FormData): Promise<FavouriteActionState> {
  const raw = Object.fromEntries(formData.entries());
  const entryId = typeof raw.entry_id === "string" && raw.entry_id !== "" ? raw.entry_id : null;
  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  let description = typeof raw.description === "string" ? raw.description : "";
  let mealType = typeof raw.meal_type === "string" && raw.meal_type !== "" ? raw.meal_type : undefined;
  if (entryId) {
    const { data: entry } = await ctx.supabase
      .from("nutrition_log_entries")
      .select("meal_type, description")
      .eq("id", entryId)
      .eq("patient_id", ctx.userId)
      .maybeSingle();
    if (!entry?.description || entry.description.trim().length === 0) {
      return { error: "Only a meal you described in words can be saved as a favourite." };
    }
    description = entry.description;
    mealType = mealType ?? entry.meal_type;
  }
  const parsed = favouriteMealSchema.safeParse({ name: raw.name, description, meal_type: mealType });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { error } = await ctx.supabase.from("favourite_meals").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    name: parsed.data.name,
    description: parsed.data.description,
    meal_type: parsed.data.meal_type ?? null,
  });
  if (error) {
    if (error.code === "23505") return { error: "You already have a favourite with that name." };
    return { error: error.message };
  }
  return { success: true };
}

/** Log a favourite in one action. Bumps its use count so the ones used most come first (best effort, never blocks the log). */
export async function logFavouriteAction(favouriteId: string): Promise<NutritionActionState> {
  const parsed = entryIdSchema.safeParse({ entry_id: favouriteId });
  if (!parsed.success) return { error: "That favourite could not be found." };
  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };

  const { data: fav, error: readError } = await ctx.supabase
    .from("favourite_meals")
    .select("id, description, meal_type, use_count")
    .eq("id", parsed.data.entry_id)
    .eq("patient_id", ctx.userId)
    .maybeSingle();
  if (readError) return { error: "We could not read that favourite. Please try again." };
  if (!fav) return { error: "That favourite could not be found." };

  const inserted = await insertMeal(ctx.supabase, ctx, {
    mealType: fav.meal_type ?? mealTypeForLagosHour(new Date()),
    description: fav.description,
  });
  if (!inserted.ok) return { error: inserted.error };

  const { error: bumpError } = await ctx.supabase
    .from("favourite_meals")
    .update({ use_count: fav.use_count + 1, last_used_at: new Date().toISOString() })
    .eq("id", fav.id)
    .eq("patient_id", ctx.userId);
  if (bumpError) console.error("nutrition: favourite use count not updated", bumpError.message);
  return { success: true };
}

export async function deleteFavouriteAction(favouriteId: string): Promise<FavouriteActionState> {
  const parsed = entryIdSchema.safeParse({ entry_id: favouriteId });
  if (!parsed.success) return { error: "That favourite could not be found." };
  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };
  const { error } = await ctx.supabase.from("favourite_meals").delete().eq("id", parsed.data.entry_id).eq("patient_id", ctx.userId);
  if (error) return { error: error.message };
  return { success: true };
}

/** How the patient wants a meal summarised (numbers, or a plain word). Whether the word is SHOWN is the database gate's decision, not this. */
export async function setMealSummaryModeAction(mode: string): Promise<FavouriteActionState> {
  const parsed = mealSummaryModeSchema.safeParse({ mode });
  if (!parsed.success) return { error: "Choose numbers or words." };
  const ctx = await currentPatient();
  if ("error" in ctx) return { error: ctx.error };
  const { error } = await ctx.supabase.from("nutrition_preferences").upsert(
    { patient_id: ctx.userId, organisation_id: ctx.organisationId, meal_summary_mode: parsed.data.mode },
    { onConflict: "patient_id" },
  );
  if (error) return { error: error.message };
  return { success: true };
}

/** Today's targets and totals, or `hidden` (which the interface renders as nothing at all). See lib/nutrition/guidance.ts. */
export async function loadNutritionGuidanceAction(): Promise<NutritionGuidance> {
  const ctx = await currentPatient();
  if ("error" in ctx) return { state: "hidden" };
  return loadNutritionGuidance(ctx.supabase, ctx.userId);
}

export type BarcodeActionState = (BarcodeLookup & { ok: true }) | { ok: false; error: string };

/** Look a typed (or scanned) product code up in the team-curated Nigerian packaged-food list. */
export async function lookupBarcodeAction(code: string): Promise<BarcodeActionState> {
  const parsed = barcodeCodeSchema.safeParse({ code });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter the whole code." };
  const normalised = normaliseBarcode(parsed.data.code);
  if (!isValidGtin(normalised)) return { ok: true, status: "invalid" };
  const ctx = await currentPatient();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { data, error } = await ctx.supabase.rpc("lookup_barcode", { p_code: normalised });
  if (error) return { ok: false, error: "We could not look that up right now. You can still type what you ate." };
  return { ok: true, ...parseBarcodeLookup(data) };
}
