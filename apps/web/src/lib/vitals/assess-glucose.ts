import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@tarragon/shared";
import {
  classifyGlucose,
  suspectsType1,
  HYPERGLYCAEMIA_KINDS,
  type GlucoseFlag,
  type GlucoseFlagKind,
  type KetoneUrineBand,
} from "./glucose-red-flags";
import { ageFromDateOfBirth } from "@tarragon/shared";

/** Trailing window for the pattern flags (persistent-high / recurrent-hypo). */
const GLUCOSE_WINDOW_DAYS = 14;
/** Ketones are only clinically paired with glucose while fresh. */
const KETONE_FRESH_HOURS = 24;
/** Don't raise a second glucose emergency while one is still active. */
const EMERGENCY_DEDUPE_HOURS = 3;

const ALERT_TITLE: Record<Exclude<GlucoseFlagKind, "severe_hypo" | "suspected_dka" | "none">, string> = {
  hypo_alert: "Priority: hypoglycaemia flagged",
  very_high: "Priority: very high glucose flagged",
  ketones_raised: "Priority: raised ketones flagged",
  persistent_hyperglycaemia: "Persistent high glucose flagged for review",
  recurrent_hypo: "Recurrent hypoglycaemia flagged for review",
  ketones_moderate: "Moderate ketones flagged for review",
};

/**
 * Best-effort glucose/ketone red-flag assessment — the diabetes counterpart to
 * assessBpControlBestEffort, run after every glucose OR ketones vitals insert
 * (manual logVital + device-sync ingestion) so a dangerous value is NEVER lost
 * (§15, "the platform detects and surfaces EVERY red flag automatically").
 *
 * Unlike the BP/heart-rate assessors this can act on a SINGLE reading, because
 * one severe hypo or a DKA-range value is meaningful on its own. The two
 * emergency tiers reuse the emergency_events machinery (acknowledge-gated
 * patient safety-net + emergency-contact auto-notify + emergency clinician
 * alert); urgent/amber tiers raise a deduped clinician_alert.
 *
 * Never throws and never blocks the caller — but a raised red flag is the whole
 * point, so failures are swallowed only to protect the log-write success path,
 * never to drop the flag silently on the happy path.
 */
export async function assessGlucoseBestEffort(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string,
): Promise<void> {
  const now = Date.now();
  const glucoseSince = new Date(now - GLUCOSE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const ketoneSince = new Date(now - KETONE_FRESH_HOURS * 60 * 60 * 1000).toISOString();

  const { data: glucoseRows } = await supabase
    .from("vitals_readings")
    .select("glucose_mmol_l, taken_at")
    .eq("patient_id", patientId)
    .eq("vital_type", "glucose")
    .gte("taken_at", glucoseSince)
    .order("taken_at", { ascending: false });

  const { data: ketoneRows } = await supabase
    .from("vitals_readings")
    .select("ketones_mmol_l, ketone_urine, taken_at")
    .eq("patient_id", patientId)
    .eq("vital_type", "ketones")
    .gte("taken_at", ketoneSince)
    .order("taken_at", { ascending: false });

  const recentGlucose = (glucoseRows ?? [])
    .map((r) => r.glucose_mmol_l)
    .filter((v): v is number => v !== null);

  const latestGlucose = recentGlucose[0] ?? null;
  const latestKetone = (ketoneRows ?? [])[0];

  // Individualised target (§9): relax ONLY the amber persistent-high band for a
  // 'relaxed' (elderly/frail/hypo-prone) patient — safety thresholds unchanged.
  const { data: target } = await supabase
    .from("patient_glucose_targets")
    .select("category, upper_target")
    .eq("patient_id", patientId)
    .maybeSingle();
  const persistentHighThreshold =
    target?.category === "relaxed" ? Math.max(14, (target.upper_target ?? 10) + 4) : undefined;

  const flag = classifyGlucose(
    {
      latestGlucose,
      latestKetoneMmol: latestKetone?.ketones_mmol_l ?? null,
      latestKetoneUrine: (latestKetone?.ketone_urine as KetoneUrineBand | null) ?? null,
      recentGlucose,
    },
    { persistentHighThreshold },
  );

  if (flag.tier === "none") return;

  // Suspected type-1 clue (§4): annotate a hyperglycaemia flag for a young/lean
  // patient so the doctor doesn't assume type 2 and delay insulin. Only reached
  // when a flag already fired, so it adds at most one small profile lookup.
  if (HYPERGLYCAEMIA_KINDS.includes(flag.kind)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("date_of_birth")
      .eq("id", patientId)
      .maybeSingle();
    const ageYears = profile?.date_of_birth ? ageFromDateOfBirth(profile.date_of_birth) : null;
    // BMI needs height, which the vitals record doesn't carry — pass null, and
    // suspectsType1 errs toward suspicion for a young patient with unknown BMI
    // (per the pathway: a lean/young clue must not be missed).
    if (suspectsType1({ ageYears, bmi: null })) {
      flag.detail +=
        " ⚠ Young patient — consider TYPE 1 / ketosis-prone diabetes: do not assume type 2, do not delay insulin, and arrange same-day review + specialist linkage (§4).";
    }
  }

  if (flag.tier === "emergency") {
    await raiseGlucoseEmergency(supabase, patientId, organisationId, flag);
    return;
  }

  await raiseGlucoseAlert(patientId, organisationId, flag);
}

/**
 * Severe hypo / suspected DKA → an emergency_events row in the patient's own
 * session (RLS-scoped, patient_id = self), whose BEFORE INSERT trigger raises
 * the emergency clinician_alert and gives the patient the acknowledge-gated
 * "get help now" safety net. Deduped against a still-active glucose emergency
 * so repeated logs during one crisis don't spawn duplicates.
 */
async function raiseGlucoseEmergency(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string,
  flag: GlucoseFlag,
): Promise<void> {
  const since = new Date(Date.now() - EMERGENCY_DEDUPE_HOURS * 60 * 60 * 1000).toISOString();
  const { data: active } = await supabase
    .from("emergency_events")
    .select("id")
    .eq("patient_id", patientId)
    .eq("source", "glucose_red_flag")
    .eq("status", "active")
    .gte("created_at", since)
    .maybeSingle();
  if (active) return;

  await supabase.from("emergency_events").insert({
    patient_id: patientId,
    organisation_id: organisationId,
    source: "glucose_red_flag",
    trigger_detail: flag.detail,
    status: "active",
  });
}

/**
 * Urgent / amber → a deduped clinician_alert (staff-write, so service-role,
 * same as assessHeartRateBestEffort). Urgent = same-day (§16 RED), amber =
 * routine review (§16 AMBER). Only a doctor may stand the alert down.
 */
async function raiseGlucoseAlert(
  patientId: string,
  organisationId: string,
  flag: GlucoseFlag,
): Promise<void> {
  const title = ALERT_TITLE[flag.kind as keyof typeof ALERT_TITLE];
  if (!title) return;

  const serviceRole = createServiceRoleClient();

  const { data: existing } = await serviceRole
    .from("clinician_alerts")
    .select("id")
    .eq("patient_id", patientId)
    .eq("title", title)
    .eq("status", "open")
    .maybeSingle();
  if (existing) return;

  const isUrgent = flag.tier === "urgent";
  await serviceRole.from("clinician_alerts").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    level: isUrgent ? "urgent_escalation" : "clinician_review",
    status: "open",
    title,
    detail: flag.detail,
    escalation_level: isUrgent ? 3 : 2,
    sla_due_at: new Date(Date.now() + (isUrgent ? 4 : 72) * 60 * 60 * 1000).toISOString(),
  });
}

export type { GlucoseFlag } from "./glucose-red-flags";
