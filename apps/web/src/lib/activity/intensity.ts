import { COMMON_ACTIVITY_NAMES } from "@/lib/validation/activity";

/**
 * MET-based intensity/calorie estimate for logged workouts, and progress
 * toward WHO's weekly activity guideline (150 min moderate, or 75 vigorous
 * counting double, per week). MET values are the same Compendium of
 * Physical Activities figures the marketing activity-intensity calculator
 * uses (apps/web/src/app/(marketing)/_components/activity-intensity-calculator.tsx)
 * — kept here as the shared source so the two never drift, and so this
 * becomes real, cumulative, patient-data-driven progress instead of the
 * marketing tool's single-session estimate.
 */

export type ActivityIntensity = "light" | "moderate" | "vigorous";

type ActivityProfile = { met: number; intensity: ActivityIntensity };

/** Keyed to the dashboard's COMMON_ACTIVITY_NAMES picker. Free-text entries
 * (the DB column accepts any text) fall back to DEFAULT_ACTIVITY_PROFILE
 * rather than guessing a match. */
const ACTIVITY_PROFILES: Record<(typeof COMMON_ACTIVITY_NAMES)[number], ActivityProfile> = {
  "Indoor Walk": { met: 3.0, intensity: "moderate" },
  "Outdoor Walk": { met: 3.8, intensity: "moderate" },
  Run: { met: 7.0, intensity: "vigorous" },
  Swimming: { met: 7.0, intensity: "vigorous" },
  Cycling: { met: 4.0, intensity: "moderate" },
  "Strength Training": { met: 5.0, intensity: "moderate" },
  Yoga: { met: 2.5, intensity: "light" },
  Other: { met: 3.5, intensity: "moderate" },
};

const DEFAULT_ACTIVITY_PROFILE: ActivityProfile = { met: 3.5, intensity: "moderate" };

export function classifyActivity(activityName: string): ActivityProfile {
  return ACTIVITY_PROFILES[activityName as (typeof COMMON_ACTIVITY_NAMES)[number]] ?? DEFAULT_ACTIVITY_PROFILE;
}

/** calories = MET x weight(kg) x hours — same formula as the marketing tool. */
export function caloriesBurned(met: number, weightKg: number, durationMinutes: number): number {
  return Math.round(met * weightKg * (durationMinutes / 60));
}

/** Vigorous minutes count double toward WHO's guideline; light doesn't count. */
export function moderateEquivalentMinutes(intensity: ActivityIntensity, durationMinutes: number): number {
  if (intensity === "vigorous") return durationMinutes * 2;
  if (intensity === "moderate") return durationMinutes;
  return 0;
}

export const WHO_WEEKLY_TARGET_MINUTES = 150;
