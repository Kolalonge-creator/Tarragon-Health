import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { classifyBpLevel } from "@/lib/rules/bp-classification";
import { classifySpo2Level } from "@/lib/rules/spo2-classification";
import { classifyPulseLevel } from "@/lib/rules/pulse-classification";
import { classifyTemperatureLevel } from "@/lib/rules/temperature-classification";
import { classifyLatestGlucoseLevel } from "@/lib/rules/glucose-classification";
import {
  computeMonitoringStatus,
  type MonitoringStatus,
  type VitalLevel,
} from "@/lib/clinical/patient-monitoring-status";

type AlertLevel = Database["public"]["Enums"]["alert_level"];
type Sex = Database["public"]["Enums"]["sex"];

export interface PatientMonitoringRow {
  id: string;
  fullName: string;
  patientNumber: string | null;
  avatarUrl: string | null;
  sex: Sex | null;
  ageYears: number | null;
  status: MonitoringStatus;
  vitals: {
    bp: { systolic: number | null; diastolic: number | null; level: VitalLevel; takenAt: string | null };
    spo2: { value: number | null; level: VitalLevel; takenAt: string | null };
    temperature: { value: number | null; level: VitalLevel; takenAt: string | null };
    glucose: { value: number | null; level: VitalLevel; takenAt: string | null };
    // pulse gained a real single-reading threshold (pulse_red_flag_engine,
    // classify_pulse_level) — extreme-value triage only, never
    // arrhythmia/AF detection; assess-heart-rate.ts's 30-day pattern check is
    // the separate, complementary mechanism for a sustained abnormal pattern.
    pulse: { value: number | null; level: VitalLevel; takenAt: string | null };
    // Deliberately no `level` on weight: no single-reading clinical threshold
    // exists for it anywhere on the platform. Shown as a plain informational
    // tile rather than inventing one.
    weight: { value: number | null; takenAt: string | null };
  };
  // Wearable-only metrics (steps, sleep, HRV) have no clinical severity bands
  // on this platform yet — informational tiles only, per the founder's
  // confirmed "appetite to design this later, not now" decision.
  wearable: {
    hrvMs: number | null;
    sleepMinutes: number | null;
    steps: number | null;
    lastSyncedAt: string | null;
  };
  openAlertLevel: AlertLevel | null;
  openAlertCount: number;
}

export interface LoadPatientMonitoringRosterOptions {
  q?: string;
  /** "Assigned to me" toggle — mirrors clinician/patients/page.tsx's `mine`
   * query param. Every org-staff account can still see the whole roster
   * (cross-coverage); this only changes what's shown by default. */
  mineOnly?: boolean;
  callerId?: string | null;
  limit?: number;
}

/**
 * What the monitoring page needs to know beyond the rows themselves.
 *
 * The two failures here are not the same event and must not render the same
 * way. `rosterFailed` means we do not know who the patients are, and used to
 * come out as "No patients match these filters" on a full roster.
 * `readingsFailed` is subtler and worse: the roster loads, so every patient
 * is listed, but the batched vitals RPC returned nothing and every card
 * renders as a patient who has logged no BP, no glucose, no SpO2 and has no
 * open alert. A screen of patients who all look quiet is the most reassuring
 * thing this page can draw, and a broken RPC drew it.
 */
export interface PatientMonitoringRoster {
  rows: PatientMonitoringRow[];
  rosterFailed: boolean;
  readingsFailed: boolean;
}

/**
 * Loads the org patient roster (RLS-scoped via private.is_org_staff, same as
 * clinician/patients/page.tsx) joined with each patient's latest vitals,
 * latest wearable-only metrics, and open clinician_alerts summary — batched
 * through the patient_monitoring_latest_readings RPC rather than one query
 * per patient (see its migration for why DISTINCT ON can't be expressed
 * through PostgREST directly).
 */
export async function loadPatientMonitoringRoster(
  supabase: SupabaseClient<Database>,
  options: LoadPatientMonitoringRosterOptions
): Promise<PatientMonitoringRoster> {
  const { q, mineOnly, callerId, limit = 200 } = options;

  let assignedPatientIds: string[] | null = null;
  if (mineOnly) {
    const { data: assignments, error: assignmentsError } = callerId
      ? await supabase.from("care_team_assignment").select("patient_id").eq("clinician_id", callerId)
      : { data: [] as { patient_id: string }[], error: null };
    if (assignmentsError) {
      return { rows: [], rosterFailed: true, readingsFailed: false };
    }
    assignedPatientIds = (assignments ?? []).map((a) => a.patient_id);
    if (assignedPatientIds.length === 0) {
      return { rows: [], rosterFailed: false, readingsFailed: false };
    }
  }

  let query = supabase
    .from("profiles")
    .select("id, full_name, patient_number, avatar_url, sex, date_of_birth")
    .eq("role", "patient")
    .order("full_name", { ascending: true })
    .limit(limit);
  if (q?.trim()) {
    query = query.ilike("full_name", `%${q.trim()}%`);
  }
  if (mineOnly && assignedPatientIds) {
    query = query.in("id", assignedPatientIds);
  }

  const { data: patients, error: patientsError } = await query;
  if (patientsError) return { rows: [], rosterFailed: true, readingsFailed: false };
  if (!patients || patients.length === 0) {
    return { rows: [], rosterFailed: false, readingsFailed: false };
  }

  const patientIds = patients.map((p) => p.id);
  const { data: readings, error: readingsError } = await supabase.rpc(
    "patient_monitoring_latest_readings",
    { p_patient_ids: patientIds }
  );
  const readingsByPatient = new Map((readings ?? []).map((r) => [r.patient_id, r]));

  const rows = patients.map((p) => {
    const r = readingsByPatient.get(p.id);
    const bpLevel = classifyBpLevel(r?.systolic, r?.diastolic);
    const spo2Level = classifySpo2Level(r?.spo2_pct);
    const temperatureLevel = classifyTemperatureLevel(r?.temperature_c);
    const glucoseLevel = classifyLatestGlucoseLevel(r?.glucose_mmol_l);
    const pulseLevel = classifyPulseLevel(r?.pulse_bpm);

    return {
      id: p.id,
      fullName: p.full_name ?? "Unnamed patient",
      patientNumber: p.patient_number,
      avatarUrl: p.avatar_url,
      sex: p.sex,
      ageYears: ageFromDateOfBirth(p.date_of_birth),
      status: computeMonitoringStatus({
        hasOpenAlert: (r?.open_alert_count ?? 0) > 0,
        vitalLevels: [bpLevel, spo2Level, temperatureLevel, glucoseLevel, pulseLevel],
      }),
      vitals: {
        bp: {
          systolic: r?.systolic ?? null,
          diastolic: r?.diastolic ?? null,
          level: bpLevel,
          takenAt: r?.bp_taken_at ?? null,
        },
        spo2: { value: r?.spo2_pct ?? null, level: spo2Level, takenAt: r?.spo2_taken_at ?? null },
        temperature: {
          value: r?.temperature_c ?? null,
          level: temperatureLevel,
          takenAt: r?.temperature_taken_at ?? null,
        },
        glucose: {
          value: r?.glucose_mmol_l ?? null,
          level: glucoseLevel,
          takenAt: r?.glucose_taken_at ?? null,
        },
        pulse: { value: r?.pulse_bpm ?? null, level: pulseLevel, takenAt: r?.pulse_taken_at ?? null },
        weight: { value: r?.weight_kg ?? null, takenAt: r?.weight_taken_at ?? null },
      },
      wearable: {
        hrvMs: r?.hrv_ms ?? null,
        sleepMinutes: r?.sleep_minutes ?? null,
        steps: r?.steps ?? null,
        lastSyncedAt: r?.wearable_last_synced_at ?? null,
      },
      openAlertLevel: r?.open_alert_level ?? null,
      openAlertCount: r?.open_alert_count ?? 0,
    };
  });

  return { rows, rosterFailed: false, readingsFailed: readingsError !== null };
}
