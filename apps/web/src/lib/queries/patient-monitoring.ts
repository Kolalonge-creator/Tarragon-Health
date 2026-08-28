import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { classifyBpLevel } from "@/lib/rules/bp-classification";
import { classifySpo2Level } from "@/lib/rules/spo2-classification";
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
    // Deliberately no `level` on pulse/weight: no single-reading clinical
    // threshold exists for either anywhere on the platform (heart rate is
    // only ever pattern-assessed over a trailing window — see
    // assess-heart-rate.ts — and weight carries no red-flag logic at all).
    // Shown as plain informational tiles rather than inventing a threshold.
    pulse: { value: number | null; takenAt: string | null };
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
  /** Average adherence % across this patient's active monitoring_schedule_
   * items over a 28-day window (§6.13). Null when they have none — not
   * enrolled in a chronic programme, not "0% adherent". */
  avgAdherencePct: number | null;
  /** Readings in the last 7 days that raised a clinician_alerts row (§6.16
   * "2 abnormal readings") — reuses the platform's own red-flag
   * classification rather than a second one computed here. */
  abnormalReadingCount7d: number;
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
): Promise<PatientMonitoringRow[]> {
  const { q, mineOnly, callerId, limit = 200 } = options;

  let assignedPatientIds: string[] | null = null;
  if (mineOnly) {
    const { data: assignments } = callerId
      ? await supabase.from("care_team_assignment").select("patient_id").eq("clinician_id", callerId)
      : { data: [] as { patient_id: string }[] };
    assignedPatientIds = (assignments ?? []).map((a) => a.patient_id);
    if (assignedPatientIds.length === 0) return [];
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

  const { data: patients } = await query;
  if (!patients || patients.length === 0) return [];

  const patientIds = patients.map((p) => p.id);
  const { data: readings } = await supabase.rpc("patient_monitoring_latest_readings", {
    p_patient_ids: patientIds,
  });
  const readingsByPatient = new Map((readings ?? []).map((r) => [r.patient_id, r]));

  return patients.map((p) => {
    const r = readingsByPatient.get(p.id);
    const bpLevel = classifyBpLevel(r?.systolic, r?.diastolic);
    const spo2Level = classifySpo2Level(r?.spo2_pct);
    const temperatureLevel = classifyTemperatureLevel(r?.temperature_c);
    const glucoseLevel = classifyLatestGlucoseLevel(r?.glucose_mmol_l);

    return {
      id: p.id,
      fullName: p.full_name ?? "Unnamed patient",
      patientNumber: p.patient_number,
      avatarUrl: p.avatar_url,
      sex: p.sex,
      ageYears: ageFromDateOfBirth(p.date_of_birth),
      status: computeMonitoringStatus({
        hasOpenAlert: (r?.open_alert_count ?? 0) > 0,
        vitalLevels: [bpLevel, spo2Level, temperatureLevel, glucoseLevel],
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
        pulse: { value: r?.pulse_bpm ?? null, takenAt: r?.pulse_taken_at ?? null },
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
      avgAdherencePct: r?.avg_adherence_pct ?? null,
      abnormalReadingCount7d: r?.abnormal_reading_count_7d ?? 0,
    };
  });
}
