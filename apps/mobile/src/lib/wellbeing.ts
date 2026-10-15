import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import { en, t, type MessageKey } from "@tarragon/i18n";
import { mergeMoodBpSleep, type MoodTrendDay, type WellbeingTag } from "@tarragon/shared";

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
  /** Optional context from the fixed list (S56, 10.1). Already cleaned by the caller with cleanWellbeingTags. */
  tags?: WellbeingTag[];
}): Promise<QueryResult<null>> {
  const { error } = await supabase.from("wellbeing_checkins").insert({
    patient_id: input.patientId,
    organisation_id: input.organisationId,
    mood_score: input.moodScore,
    stress_score: input.stressScore,
    sleep_quality: input.sleepQuality,
    activity_level: input.activityLevel,
    note: input.note ?? null,
    tags: input.tags ?? [],
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

/** Display copy for a check-in tag (catalogue namespace mood). */
export function wellbeingTagLabel(tag: string): string {
  const key = `mood.tag.${tag}` as MessageKey;
  return key in en ? t(key) : tag;
}

/**
 * Mood beside blood pressure and sleep for the last 30 days (function 10.1): the patient's own check-ins, blood pressure readings and
 * sleep log merged per Lagos day. All three are the patient's own rows under their own session. A failed read throws, so the screen can
 * say it could not load rather than show an empty week.
 */
export async function loadMoodBesideReadings(patientId: string): Promise<MoodTrendDay[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const [checkins, bp, sleep] = await Promise.all([
    supabase.from("wellbeing_checkins").select("checked_in_at, mood_score, stress_score, tags").eq("patient_id", patientId).gte("checked_in_at", sinceIso).order("checked_in_at", { ascending: true }),
    supabase.from("vitals_readings").select("taken_at, systolic, diastolic").eq("patient_id", patientId).eq("vital_type", "blood_pressure").gte("taken_at", sinceIso).order("taken_at", { ascending: true }).limit(200),
    supabase.from("sleep_log_entries").select("logged_on, duration_hours").eq("patient_id", patientId).gte("logged_on", sinceIso.slice(0, 10)).order("logged_on", { ascending: true }),
  ]);
  if (checkins.error) throw checkins.error;
  if (bp.error) throw bp.error;
  if (sleep.error) throw sleep.error;
  return mergeMoodBpSleep(
    checkins.data ?? [],
    (bp.data ?? []).map((r) => ({ taken_at: r.taken_at, systolic: r.systolic, diastolic: r.diastolic })),
    (sleep.data ?? []).map((r) => ({ day: r.logged_on, minutes: Math.round(Number(r.duration_hours) * 60) })),
  );
}
