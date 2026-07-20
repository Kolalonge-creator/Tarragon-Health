"use server";

import type { Json, TablesInsert } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { nutritionLogSchema, nutritionConfirmSchema } from "@/lib/validation/nutrition";
import { analyzeMealPhoto, isMealVisionConfigured } from "@/lib/nutrition/meal-vision";

const MEAL_PHOTO_BUCKET = "meal-photos";

export type NutritionActionState =
  | { error?: string; success?: boolean; aiStatus?: "none" | "estimated" | "unavailable" }
  | undefined;

async function currentPatient() {
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

  const row: TablesInsert<"nutrition_log_entries"> = {
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    meal_type,
    description: description ?? null,
    photo_path: photo_path ?? null,
    ai_estimate: aiEstimate,
    ai_status: aiStatus,
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
