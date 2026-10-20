import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  ageInYears,
  computeDailyTargets,
  parseTargetsGate,
  sumDay,
  type AnalysisLike,
  type DailyTargets,
  type DayTotals,
  type NutritionTargetConfig,
} from "@tarragon/shared";

/**
 * Daily targets and the word summary, for ONE patient (the signed-in one).
 *
 * The decision to show anything is the database's: `my_nutrition_target_gate()` returns the signed configuration only when targets
 * are not withheld for this person (pregnancy, the postnatal year, a clinician hold, a positive eating-disorder screen, under 18),
 * and never says why. Here "withheld" and "not active" are both `hidden`, and the interface shows NOTHING for either: no empty
 * card, no hint, so that the absence tells nobody anything. An RPC error is also `hidden` (the safe direction), logged, never shown as zeros.
 */
export type MealSummaryMode = "numbers" | "words";

export type NutritionGuidance =
  // `mode` is the patient's own preference, kept even when nothing may be shown, so that a patient who asked for no numbers never gets numbers back
  // because targets were withheld, the call failed or the preference could not be read (an unreadable preference counts as "words", the cautious reading).
  | { state: "hidden"; mode: MealSummaryMode }
  | {
      state: "needs_profile";
      missing: ("age" | "sex" | "weight" | "height")[];
      mode: MealSummaryMode;
      mealSummary: NutritionTargetConfig["meal_summary"];
    }
  | {
      state: "ok";
      configVersion: number;
      targets: DailyTargets;
      floorApplied: boolean;
      totals: DayTotals;
      mode: MealSummaryMode;
      mealSummary: NutritionTargetConfig["meal_summary"];
    };

/** Start of the current Africa/Lagos day (UTC+1, no DST) as an ISO instant. */
export function lagosDayStart(now: Date): string {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  lagos.setUTCHours(0, 0, 0, 0);
  return new Date(lagos.getTime() - 60 * 60 * 1000).toISOString();
}

export async function loadNutritionGuidance(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date = new Date(),
): Promise<NutritionGuidance> {
  const [gateRes, prefRes] = await Promise.all([
    supabase.rpc("my_nutrition_target_gate"),
    supabase.from("nutrition_preferences").select("meal_summary_mode").eq("patient_id", userId).maybeSingle(),
  ]);
  let mode: MealSummaryMode = "words";
  if (prefRes.error) {
    console.error("nutrition: summary preference unreadable, showing no numbers", prefRes.error.message);
  } else {
    mode = prefRes.data?.meal_summary_mode === "words" ? "words" : "numbers";
  }
  if (gateRes.error) {
    console.error("nutrition: targets gate failed, showing no targets", gateRes.error.message);
    return { state: "hidden", mode };
  }
  const gate = parseTargetsGate(gateRes.data);
  if (gate.state !== "ok" || prefRes.error) return { state: "hidden", mode };

  const [profileRes, weightRes, entriesRes] = await Promise.all([
    supabase.from("profiles").select("date_of_birth, sex, height_cm").eq("id", userId).maybeSingle(),
    supabase
      .from("vitals_readings")
      .select("weight_kg")
      .eq("patient_id", userId)
      .eq("vital_type", "weight")
      .is("correction_status", null)
      .not("weight_kg", "is", null)
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("nutrition_log_entries").select("nutrition_analysis").eq("patient_id", userId).gte("logged_at", lagosDayStart(now)),
  ]);
  if (profileRes.error || weightRes.error || entriesRes.error) {
    console.error(
      "nutrition: could not read profile, weight or today's meals, showing no targets",
      profileRes.error?.message ?? weightRes.error?.message ?? entriesRes.error?.message,
    );
    return { state: "hidden", mode };
  }
  const mealSummary = gate.config.meal_summary;
  const profile = profileRes.data;

  const result = computeDailyTargets(
    {
      ageYears: ageInYears(profile?.date_of_birth ?? null, now),
      sex: profile?.sex ?? null,
      weightKg: weightRes.data?.weight_kg ?? null,
      heightCm: profile?.height_cm ?? null,
    },
    gate.config,
  );
  if (result.status === "too_young") return { state: "hidden", mode };
  if (result.status === "needs_profile") return { state: "needs_profile", missing: result.missing, mode, mealSummary };

  const totals = sumDay((entriesRes.data ?? []).map((e) => e.nutrition_analysis as unknown as AnalysisLike | null));
  return {
    state: "ok",
    configVersion: gate.configVersion,
    targets: result.targets,
    floorApplied: result.floorApplied,
    totals,
    mode,
    mealSummary,
  };
}
