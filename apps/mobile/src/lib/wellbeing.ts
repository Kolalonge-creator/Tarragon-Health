import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

// --- Wellbeing self check-in (mood/stress/sleep/activity, 1-5) -----------
// Mirrors apps/web/.../patient/wellbeing-actions.ts and lib/queries/
// wellbeing.ts. Plain RLS-scoped inserts/reads — never a clinical
// instrument, never fed into escalation logic (that's mental-health.ts).

export const WELLBEING_SCALE_QUESTIONS = [
  { name: "mood_score" as const, prompt: "How has your mood been?", low: "Struggling", high: "Great" },
  { name: "stress_score" as const, prompt: "How stressed have you felt?", low: "Calm", high: "Very stressed" },
  { name: "sleep_quality" as const, prompt: "How has your sleep been?", low: "Poor", high: "Great" },
  { name: "activity_level" as const, prompt: "How active have you been?", low: "Not at all", high: "Very active" },
] as const;

export interface WellbeingCheckin {
  mood_score: number;
  stress_score: number;
  sleep_quality: number;
  activity_level: number;
  checked_in_at: string;
}

export type WellbeingBand = "attention" | "moderate" | "stable";
const BAND_LABEL: Record<WellbeingBand, string> = {
  attention: "Needs attention",
  moderate: "Moderate",
  stable: "Stable",
};

/** Higher score = better (mood, sleep). */
export function bandHigherIsBetter(score: number): WellbeingBand {
  if (score <= 2) return "attention";
  if (score === 3) return "moderate";
  return "stable";
}

/** Higher score = worse (stress). */
export function bandLowerIsBetter(score: number): WellbeingBand {
  if (score >= 4) return "attention";
  if (score === 3) return "moderate";
  return "stable";
}

export function wellbeingBandLabel(band: WellbeingBand): string {
  return BAND_LABEL[band];
}

export async function loadLatestWellbeingCheckin(patientId: string): Promise<WellbeingCheckin | null> {
  const { data } = await supabase
    .from("wellbeing_checkins")
    .select("mood_score, stress_score, sleep_quality, activity_level, checked_in_at")
    .eq("patient_id", patientId)
    .order("checked_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export interface WellbeingTrendPoint {
  checked_in_at: string;
  mood_score: number;
  stress_score: number;
  sleep_quality: number;
}

const WELLBEING_TREND_WINDOW_DAYS = 90;

/** Ascending-order check-ins for the wellbeing trend chart — same 90-day
 * window and left-to-right ordering as web's useWellbeingTrend (apps/web/
 * .../lib/queries/wellbeing.ts). Still pure engagement telemetry, never fed
 * into escalation/risk scoring. */
export async function loadWellbeingCheckinHistory(
  patientId: string,
  windowDays: number = WELLBEING_TREND_WINDOW_DAYS
): Promise<WellbeingTrendPoint[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("wellbeing_checkins")
    .select("checked_in_at, mood_score, stress_score, sleep_quality")
    .eq("patient_id", patientId)
    .gte("checked_in_at", since)
    .order("checked_in_at", { ascending: true });
  return data ?? [];
}

export async function loadWellbeingCheckinFrequencyDays(patientId: string): Promise<number> {
  const { data } = await supabase
    .from("wellbeing_checkin_preferences")
    .select("reminder_frequency_days")
    .eq("patient_id", patientId)
    .maybeSingle();
  return data?.reminder_frequency_days ?? 7;
}

export async function loadNextReviewDue(patientId: string): Promise<string | null> {
  const [medReview, screeningDue] = await Promise.all([
    supabase
      .from("medication_reviews")
      .select("due_date")
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("mental_health_screening_schedules")
      .select("due_date")
      .eq("patient_id", patientId)
      .order("due_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const candidates = [medReview.data?.due_date, screeningDue.data?.due_date].filter((d): d is string => Boolean(d));
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, d) => (d < earliest ? d : earliest));
}

export async function submitWellbeingCheckin(input: {
  patientId: string;
  organisationId: string;
  moodScore: number;
  stressScore: number;
  sleepQuality: number;
  activityLevel: number;
  note?: string;
}): Promise<QueryResult<null>> {
  const { error } = await supabase.from("wellbeing_checkins").insert({
    patient_id: input.patientId,
    organisation_id: input.organisationId,
    mood_score: input.moodScore,
    stress_score: input.stressScore,
    sleep_quality: input.sleepQuality,
    activity_level: input.activityLevel,
    note: input.note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function updateWellbeingCheckinFrequency(
  patientId: string,
  organisationId: string,
  frequencyDays: number
): Promise<QueryResult<null>> {
  const { error } = await supabase.from("wellbeing_checkin_preferences").upsert({
    patient_id: patientId,
    organisation_id: organisationId,
    reminder_frequency_days: frequencyDays,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
