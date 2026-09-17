import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { Json, TablesInsert } from "@tarragon/shared";
import { createBearerClient } from "@/lib/supabase/bearer";
import { AI_SYSTEMS, runGovernedAi } from "@/lib/ai-governance";
import { analyzeMealPhoto, isMealVisionConfigured } from "@/lib/nutrition/meal-vision";
import { nutritionLogSchema } from "@/lib/validation/nutrition";
import { recordWeeklyPlanProgress } from "@/lib/lifestyle/weekly-plan-progress";

const MEAL_PHOTO_BUCKET = "meal-photos";

// Mirrors the `meal-photos` storage bucket's own allowed_mime_types
// (20260719100000_nutrition_meal_analysis.sql) — no PDF here, unlike the
// lab-result/ECG upload routes, since a meal is always a photo.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/**
 * Mobile equivalent of logMealAction's photo path
 * (apps/web/src/app/(dashboard)/patient/nutrition-actions.ts) — same
 * governed AI-008 call (analyzeMealPhoto via runGovernedAi, unchanged: no
 * new AI logic here, just a new authenticated entry point), same
 * nutrition_log_entries insert shape, same best-effort
 * recordWeeklyPlanProgress bridge. A Server Action can't be invoked from a
 * bare fetch, hence a Route Handler — mirrors
 * /api/mobile/lab-result-upload/route.ts's bearer-auth/multipart shape.
 *
 * Where this differs from the web flow on purpose: web uploads the photo
 * to storage client-side (the browser's own session) before calling the
 * server action, which then downloads it back out to run the vision model.
 * Mobile has no equivalent client-side Supabase Storage step wired into its
 * multipart upload UI, so this route does the storage upload itself using
 * the same bearer-authenticated (RLS-scoped, own-uid-folder-only) client —
 * exactly the pattern lab-result-upload and ecg-report-upload already use
 * for their own photo uploads.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach a photo of the meal." }, { status: 400 });
  }
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Use a JPEG, PNG, WEBP or HEIC photo." },
      { status: 400 },
    );
  }
  // The storage bucket itself enforces a 10 MB file_size_limit; checking here
  // first avoids spending a vision call on a file that will fail the upload.
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "That photo is too large (max 10 MB)." }, { status: 400 });
  }

  const parsed = nutritionLogSchema.omit({ photo_path: true }).safeParse({
    meal_type: formData.get("meal_type"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { meal_type, description } = parsed.data;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return NextResponse.json({ error: "No organisation on file" }, { status: 400 });
  }

  // Leading folder MUST be the caller's uid — the storage own-folder policy
  // checks exactly this, same as every other mobile photo-upload route.
  const path = `${user.id}/${randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(MEAL_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  let aiEstimate: Json | null = null;
  let aiStatus: "estimated" | "unavailable" = "unavailable";

  if (isMealVisionConfigured()) {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

    // AI-008, same governed call the web server action makes — see
    // logMealAction in nutrition-actions.ts. No new AI logic: this reuses
    // analyzeMealPhoto and AI_SYSTEMS.mealPhotoNutrition unchanged.
    const governed = await runGovernedAi<Json | null>({
      supabase,
      systemCode: AI_SYSTEMS.mealPhotoNutrition.code,
      inputCategory: "meal_photo",
      subjectProfileId: user.id,
      run: async () => {
        const result = await analyzeMealPhoto({
          imageBase64: base64,
          mediaType: file.type,
          description,
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
    }
  }

  const row: TablesInsert<"nutrition_log_entries"> = {
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    meal_type,
    description: description ?? null,
    photo_path: path,
    ai_estimate: aiEstimate,
    ai_status: aiStatus,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("nutrition_log_entries")
    .insert(row)
    .select("id")
    .single();
  if (insertError || !inserted) {
    // Roll back the orphaned object so a failed insert leaves no stray file.
    await supabase.storage.from(MEAL_PHOTO_BUCKET).remove([path]);
    return NextResponse.json(
      { error: insertError?.message ?? "Could not save that meal." },
      { status: 500 },
    );
  }

  // Bridges into the Weekly Plan card's own completion tracking, same as
  // logMealAction — best-effort and additive, never throws.
  await recordWeeklyPlanProgress(supabase, {
    patientId: user.id,
    organisationId: profile.organisation_id,
    metric: "food_log",
    valueJson: { meal_type },
    unit: "check",
  });

  return NextResponse.json({
    success: true,
    entryId: inserted.id as string,
    aiStatus,
    aiEstimate,
  });
}
