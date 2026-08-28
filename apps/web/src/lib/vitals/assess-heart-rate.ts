import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database, Json } from "@tarragon/shared";

const HEART_RATE_WINDOW_DAYS = 30;
const MIN_READINGS_FOR_ASSESSMENT = 3;
const RESTING_RANGE = { min: 60, max: 100 };
const OUT_OF_RANGE_ALERT_THRESHOLD_PERCENT = 50;
const HEART_RATE_ALERT_TITLE = "Heart rate pattern flagged for review";

/**
 * Best-effort heart-rate *pattern* assessment — deliberately NOT
 * arrhythmia/AF detection. A single logged BPM value carries no rhythm
 * information (the actual signature of AF is an irregularly-irregular
 * beat-to-beat interval, which needs raw waveform/interval data this
 * platform doesn't collect from a manually-entered pulse reading), so this
 * only ever looks at a *sustained* pattern across a trailing window —
 * mirrors assessBpControlBestEffort's shape rather than the symptoms
 * table's per-event red-flag trigger, since a single elevated reading
 * (exercise, caffeine, stress) is not by itself clinically meaningful and
 * flagging every one of those would just be alert-fatigue noise. Copy in
 * the resulting alert says explicitly that this is a triage nudge, not a
 * diagnosis.
 *
 * Never throws — same best-effort contract as assessBpControlBestEffort,
 * called after every pulse vitals log regardless of source.
 */
export async function assessHeartRateBestEffort(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<void> {
  const since = new Date(Date.now() - HEART_RATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: readings }, { data: target }] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("pulse_bpm")
      .eq("patient_id", patientId)
      .eq("vital_type", "pulse")
      .gte("taken_at", since),
    // §6.10 — never one universal target. No emergency/red tier exists for
    // pulse at all (this is a best-effort pattern flag, never a page), so a
    // full resting-range override is safe — an athlete or a patient on
    // rate-controlling medication can have a genuinely different normal.
    supabase
      .from("patient_pulse_targets")
      .select("resting_min_bpm, resting_max_bpm")
      .eq("patient_id", patientId)
      .maybeSingle(),
  ]);

  const restingRange = target
    ? { min: target.resting_min_bpm, max: target.resting_max_bpm }
    : RESTING_RANGE;

  const values = (readings ?? [])
    .map((r) => r.pulse_bpm)
    .filter((v): v is number => v !== null);
  if (values.length < MIN_READINGS_FOR_ASSESSMENT) return;

  const outOfRangeCount = values.filter((v) => v < restingRange.min || v > restingRange.max).length;
  const outOfRangePercent = Math.round((outOfRangeCount / values.length) * 100);

  const serviceRoleClient = createServiceRoleClient();

  // patient_risk_scores is staff-only-write by RLS — same reasoning as
  // assessBpControlBestEffort's insert.
  await serviceRoleClient.from("patient_risk_scores").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    score_type: "heart_rate_pattern",
    score: outOfRangePercent,
    model_version: "heart_rate_pattern_v1",
    inputs: { window_days: HEART_RATE_WINDOW_DAYS, reading_count: values.length } as unknown as Json,
  });

  if (outOfRangePercent < OUT_OF_RANGE_ALERT_THRESHOLD_PERCENT) return;

  // Dedupe: don't spam a new alert on every subsequent pulse log while the
  // same underlying pattern persists and the existing alert is still open.
  const { data: existingAlert } = await serviceRoleClient
    .from("clinician_alerts")
    .select("id")
    .eq("patient_id", patientId)
    .eq("title", HEART_RATE_ALERT_TITLE)
    .eq("status", "open")
    .maybeSingle();
  if (existingAlert) return;

  await serviceRoleClient.from("clinician_alerts").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    level: "clinician_review",
    status: "open",
    title: HEART_RATE_ALERT_TITLE,
    detail: `${outOfRangePercent}% of this patient's heart rate readings over the last ${HEART_RATE_WINDOW_DAYS} days were outside ${
      target ? "this patient's individualised" : "the typical"
    } ${restingRange.min}-${restingRange.max} bpm resting range. This is a pattern-based triage flag, not a diagnosis — a single reading, exercise, or stress can all cause this on their own; worth a closer look if it persists.`,
  });
}
