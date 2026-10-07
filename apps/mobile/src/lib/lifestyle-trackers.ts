import { supabase } from "./supabase";
import { postSleepLog, API_BASE_URL, NETWORK_ERROR_MESSAGE, fetchWithTimeoutAndRetry } from "./api";
import type { QueryResult } from "./medications";

/**
 * Data layer for the six lifestyle trackers the native app previously had no
 * screens for: sleep, smoking, alcohol, activity, exercise and nutrition.
 *
 * Before this, the Lifestyle hub listed them and opened each one in the
 * SYSTEM browser (expo-web-browser), which drops the patient out of the app
 * entirely -- different chrome, a URL bar, and the app's own tab bar gone.
 * That is the single most jarring "I have left the app" moment in the
 * product, and it sat on the features a patient is meant to touch daily.
 *
 * Reads and plain writes go direct under RLS, matching how every other native
 * screen in this app was built (the 2026-09-08 WebView elimination pass).
 * The one exception is the sleep LOG, which routes through the server so
 * flagAbnormalSleep() still runs -- see postSleepLog.
 */

function lagosToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

async function organisationId(patientId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", patientId)
    .maybeSingle();
  return data?.organisation_id ?? null;
}

/** Recent history for a tracker, newest first. 30 days is what the web
 * screens show and is enough for the patient to see a pattern without
 * pulling a year of rows over a Nigerian mobile connection. */
const HISTORY_DAYS = 30;

function sinceDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - HISTORY_DAYS);
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

// ── Sleep ──────────────────────────────────────────────────────────────────

export interface SleepGoal {
  targetDurationHours: number | null;
  targetBedtime: string | null;
  targetWaketime: string | null;
}

export interface SleepEntry {
  loggedOn: string;
  durationHours: number | null;
  qualityRating: number | null;
  daytimeSleepiness: number | null;
  note: string | null;
}

export interface SleepState {
  goal: SleepGoal | null;
  entries: SleepEntry[];
}

export async function loadSleepState(patientId: string): Promise<QueryResult<SleepState>> {
  const [goalRes, logRes] = await Promise.all([
    supabase
      .from("patient_sleep_goals")
      .select("target_duration_hours, target_bedtime, target_waketime")
      .eq("patient_id", patientId)
      .maybeSingle(),
    supabase
      .from("sleep_log_entries")
      .select("logged_on, duration_hours, quality_rating, daytime_sleepiness, note")
      .eq("patient_id", patientId)
      .gte("logged_on", sinceDate())
      .order("logged_on", { ascending: false }),
  ]);

  // A failed read must not render as "you have never logged anything".
  if (logRes.error) return { ok: false, error: logRes.error.message };

  return {
    ok: true,
    data: {
      goal: goalRes.data
        ? {
            targetDurationHours: goalRes.data.target_duration_hours,
            targetBedtime: goalRes.data.target_bedtime,
            targetWaketime: goalRes.data.target_waketime,
          }
        : null,
      entries: (logRes.data ?? []).map((r) => ({
        loggedOn: r.logged_on,
        durationHours: r.duration_hours,
        qualityRating: r.quality_rating,
        daytimeSleepiness: r.daytime_sleepiness,
        note: r.note,
      })),
    },
  };
}

/** Routed through the server so the abnormal-sleep escalation still runs. */
export async function logSleep(input: {
  durationHours: number;
  qualityRating?: number;
  daytimeSleepiness?: number;
  note?: string;
}): Promise<{ error?: string }> {
  return postSleepLog({
    duration_hours: input.durationHours,
    quality_rating: input.qualityRating,
    daytime_sleepiness: input.daytimeSleepiness,
    note: input.note,
  });
}

export async function setSleepGoal(
  patientId: string,
  targetDurationHours: number
): Promise<{ error?: string }> {
  const orgId = await organisationId(patientId);
  if (!orgId) return { error: "No organisation on file" };
  const { error } = await supabase.from("patient_sleep_goals").upsert(
    {
      organisation_id: orgId,
      patient_id: patientId,
      target_duration_hours: targetDurationHours,
    },
    { onConflict: "patient_id" }
  );
  return error ? { error: error.message } : {};
}

// ── Alcohol ────────────────────────────────────────────────────────────────

export interface AlcoholState {
  targetDrinksPerWeek: number | null;
  baselineDrinksPerWeek: number | null;
  /** Last 7 Lagos days, for the "this week" figure the web screen shows. */
  drinksThisWeek: number;
  entries: { loggedOn: string; drinks: number; context: string | null }[];
}

export async function loadAlcoholState(patientId: string): Promise<QueryResult<AlcoholState>> {
  const [goalRes, logRes] = await Promise.all([
    supabase
      .from("patient_alcohol_goals")
      .select("baseline_drinks_per_week, target_drinks_per_week")
      .eq("patient_id", patientId)
      .maybeSingle(),
    supabase
      .from("alcohol_consumption_logs")
      .select("logged_on, drinks_count, context")
      .eq("patient_id", patientId)
      .gte("logged_on", sinceDate())
      .order("logged_on", { ascending: false }),
  ]);
  if (logRes.error) return { ok: false, error: logRes.error.message };

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekStart = weekAgo.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const rows = logRes.data ?? [];

  return {
    ok: true,
    data: {
      targetDrinksPerWeek: goalRes.data?.target_drinks_per_week ?? null,
      baselineDrinksPerWeek: goalRes.data?.baseline_drinks_per_week ?? null,
      drinksThisWeek: rows
        .filter((r) => r.logged_on >= weekStart)
        .reduce((sum, r) => sum + (r.drinks_count ?? 0), 0),
      entries: rows.map((r) => ({
        loggedOn: r.logged_on,
        drinks: r.drinks_count ?? 0,
        context: r.context,
      })),
    },
  };
}

export async function logAlcohol(
  patientId: string,
  drinks: number,
  context?: string
): Promise<{ error?: string }> {
  const orgId = await organisationId(patientId);
  if (!orgId) return { error: "No organisation on file" };
  const { error } = await supabase.from("alcohol_consumption_logs").insert({
    organisation_id: orgId,
    patient_id: patientId,
    logged_on: lagosToday(),
    drinks_count: drinks,
    context: context ?? null,
  });
  return error ? { error: error.message } : {};
}

// ── Smoking ────────────────────────────────────────────────────────────────

export interface SmokingState {
  status: string | null;
  cigarettesPerDay: number | null;
  quitDate: string | null;
  entries: { loggedOn: string; cigarettes: number | null; cravings: number | null }[];
}

export async function loadSmokingState(patientId: string): Promise<QueryResult<SmokingState>> {
  const [profileRes, logRes] = await Promise.all([
    supabase
      .from("patient_smoking_profiles")
      .select("status, cigarettes_per_day, quit_date")
      .eq("patient_id", patientId)
      .maybeSingle(),
    supabase
      .from("smoking_check_ins")
      .select("logged_on, cigarettes_smoked, cravings_intensity")
      .eq("patient_id", patientId)
      .gte("logged_on", sinceDate())
      .order("logged_on", { ascending: false }),
  ]);
  if (logRes.error) return { ok: false, error: logRes.error.message };

  return {
    ok: true,
    data: {
      status: profileRes.data?.status ?? null,
      cigarettesPerDay: profileRes.data?.cigarettes_per_day ?? null,
      quitDate: profileRes.data?.quit_date ?? null,
      entries: (logRes.data ?? []).map((r) => ({
        loggedOn: r.logged_on,
        cigarettes: r.cigarettes_smoked,
        cravings: r.cravings_intensity,
      })),
    },
  };
}

export async function logSmoking(
  patientId: string,
  cigarettes: number,
  cravings?: number
): Promise<{ error?: string }> {
  const orgId = await organisationId(patientId);
  if (!orgId) return { error: "No organisation on file" };
  const { error } = await supabase.from("smoking_check_ins").insert({
    organisation_id: orgId,
    patient_id: patientId,
    logged_on: lagosToday(),
    cigarettes_smoked: cigarettes,
    cravings_intensity: cravings ?? null,
  });
  return error ? { error: error.message } : {};
}

// ── Activity ───────────────────────────────────────────────────────────────

export interface ActivityState {
  dailyStepGoal: number | null;
  entries: {
    loggedOn: string;
    activityName: string | null;
    durationMinutes: number | null;
    stepCount: number | null;
  }[];
}

export async function loadActivityState(patientId: string): Promise<QueryResult<ActivityState>> {
  const [goalRes, logRes] = await Promise.all([
    supabase
      .from("patient_activity_goals")
      .select("daily_step_goal")
      .eq("patient_id", patientId)
      .maybeSingle(),
    supabase
      .from("activity_log_entries")
      .select("logged_on, activity_name, duration_minutes, step_count")
      .eq("patient_id", patientId)
      .gte("logged_on", sinceDate())
      .order("logged_on", { ascending: false }),
  ]);
  if (logRes.error) return { ok: false, error: logRes.error.message };

  return {
    ok: true,
    data: {
      dailyStepGoal: goalRes.data?.daily_step_goal ?? null,
      entries: (logRes.data ?? []).map((r) => ({
        loggedOn: r.logged_on,
        activityName: r.activity_name,
        durationMinutes: r.duration_minutes,
        stepCount: r.step_count,
      })),
    },
  };
}

export async function logActivity(
  patientId: string,
  input: { activityName: string; durationMinutes: number }
): Promise<{ error?: string }> {
  const orgId = await organisationId(patientId);
  if (!orgId) return { error: "No organisation on file" };
  const { error } = await supabase.from("activity_log_entries").insert({
    organisation_id: orgId,
    patient_id: patientId,
    logged_on: lagosToday(),
    entry_type: "workout",
    activity_name: input.activityName,
    duration_minutes: input.durationMinutes,
    source: "manual",
  });
  return error ? { error: error.message } : {};
}

// ── Meals ──────────────────────────────────────────────────────────────────

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

/** Mirrors mealEstimateSchema in apps/web/src/lib/nutrition/meal-vision.ts. */
export interface MealPhotoEstimate {
  items: { name: string; portion: string; est_carbs_g: number }[];
  est_carbs_g: number;
  est_calories: number;
  confidence: "low" | "medium" | "high";
  notes: string | null;
}

export type MealAiStatus = "none" | "estimated" | "unavailable";

export interface MealsState {
  entries: {
    id: string;
    loggedAt: string;
    mealType: MealType;
    description: string | null;
    aiStatus: MealAiStatus;
    aiEstimate: MealPhotoEstimate | null;
  }[];
}

export async function loadMealsState(patientId: string): Promise<QueryResult<MealsState>> {
  const { data, error } = await supabase
    .from("nutrition_log_entries")
    .select("id, logged_at, meal_type, description, ai_status, ai_estimate")
    .eq("patient_id", patientId)
    .order("logged_at", { ascending: false })
    .limit(60);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: {
      entries: (data ?? []).map((r) => ({
        id: r.id,
        loggedAt: r.logged_at,
        mealType: r.meal_type as MealType,
        description: r.description,
        aiStatus: (r.ai_status as MealAiStatus) ?? "none",
        aiEstimate: (r.ai_estimate as unknown as MealPhotoEstimate | null) ?? null,
      })),
    },
  };
}

/**
 * Text-only meal log, written directly under RLS like the other trackers.
 * ai_status is left at its 'none' default, which is exactly what a
 * hand-written meal is: an entry with no AI estimate attached.
 */
export async function logMeal(
  patientId: string,
  input: { mealType: MealType; description: string }
): Promise<{ error?: string }> {
  const orgId = await organisationId(patientId);
  if (!orgId) return { error: "No organisation on file" };
  const { error } = await supabase.from("nutrition_log_entries").insert({
    organisation_id: orgId,
    patient_id: patientId,
    meal_type: input.mealType,
    description: input.description,
  });
  return error ? { error: error.message } : {};
}

export interface LogMealWithPhotoResult {
  error?: string;
  aiStatus?: MealAiStatus;
  aiEstimate?: MealPhotoEstimate | null;
}

/**
 * Meal photo -> AI carb/calorie estimate, native parity with the web Meals
 * screen. Routed through the bearer-authenticated
 * /api/mobile/nutrition/meal-photo-estimate Route Handler rather than a
 * direct client insert -- that endpoint calls the exact same governed AI-008
 * call (analyzeMealPhoto via runGovernedAi) the web server action makes, so
 * this stays a registered, kill-switched AI call site rather than a second,
 * ungoverned one from the app bundle. See that route's own header for why a
 * Route Handler rather than reusing the Server Action directly.
 *
 * Uses fetchWithTimeoutAndRetry rather than api.ts's request() because the
 * body is multipart (a photo), same as labs.ts's uploadLabResult.
 */
export async function logMealWithPhoto(input: {
  mealType: MealType;
  description?: string;
  photo: { uri: string; mimeType: string; fileName: string };
}): Promise<LogMealWithPhotoResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { error: "Not signed in" };
  }

  const formData = new FormData();
  // React Native's fetch/FormData accepts { uri, type, name } for a local-file
  // upload -- see uploadLabResult's identical cast in labs.ts.
  formData.append("file", {
    uri: input.photo.uri,
    type: input.photo.mimeType,
    name: input.photo.fileName,
  } as unknown as Blob);
  formData.append("meal_type", input.mealType);
  if (input.description?.trim()) {
    formData.append("description", input.description.trim());
  }

  try {
    const response = await fetchWithTimeoutAndRetry(
      `${API_BASE_URL}/api/mobile/nutrition/meal-photo-estimate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      },
    );
    const json = (await response.json()) as {
      success?: boolean;
      error?: string;
      aiStatus?: MealAiStatus;
      aiEstimate?: MealPhotoEstimate | null;
    };
    if (!response.ok) {
      return { error: json.error ?? `Upload failed (${response.status})` };
    }
    return { aiStatus: json.aiStatus, aiEstimate: json.aiEstimate ?? null };
  } catch {
    return { error: NETWORK_ERROR_MESSAGE };
  }
}
