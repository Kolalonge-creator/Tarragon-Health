import { createClient } from "@/lib/supabase/server";
import { todayIsoDate } from "@/lib/queries/medications";
import { buildTodaysDoseChecklist } from "@/lib/medication-schedule/checklist";

export interface PatientSummaryStats {
  latestBp: { systolic: number; diastolic: number } | null;
  latestGlucoseMmolL: number | null;
  activeMedicationCount: number;
  dosesTaken: number;
  dosesTotal: number;
}

export async function getPatientSummaryStats(patientId: string): Promise<PatientSummaryStats> {
  const supabase = await createClient();
  const today = todayIsoDate();

  const [{ data: bpRows }, { data: glucoseRows }, { data: medications }, { data: doseLogs }] =
    await Promise.all([
      supabase
        .from("vitals_readings")
        .select("systolic, diastolic")
        .eq("patient_id", patientId)
        .eq("vital_type", "blood_pressure")
        .order("taken_at", { ascending: false })
        .limit(1),
      supabase
        .from("vitals_readings")
        .select("glucose_mmol_l")
        .eq("patient_id", patientId)
        .eq("vital_type", "glucose")
        .order("taken_at", { ascending: false })
        .limit(1),
      supabase
        .from("medications")
        .select("id, drug_name, schedule_times")
        .eq("patient_id", patientId)
        .eq("is_active", true),
      supabase
        .from("medication_logs")
        .select("medication_id, scheduled_time, status")
        .eq("patient_id", patientId)
        .eq("scheduled_for_date", today),
    ]);

  const checklist = buildTodaysDoseChecklist(medications ?? [], doseLogs ?? []);
  const dosesTaken = checklist.filter((item) => item.status === "taken").length;

  const bp = bpRows?.[0];
  const glucose = glucoseRows?.[0];

  return {
    latestBp:
      bp && bp.systolic !== null && bp.diastolic !== null
        ? { systolic: bp.systolic, diastolic: bp.diastolic }
        : null,
    latestGlucoseMmolL: glucose?.glucose_mmol_l ?? null,
    activeMedicationCount: medications?.length ?? 0,
    dosesTaken,
    dosesTotal: checklist.length,
  };
}
