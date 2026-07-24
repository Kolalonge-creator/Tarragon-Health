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

export interface PatientPreventionStats {
  /** Any active care plan means the patient is in a chronic programme — the
   * dashboard overview leads with chronic tiles. No plan → prevention-first. */
  hasActiveCarePlan: boolean;
  screeningsDueCount: number;
  nextScreening: { name: string; dueDate: string } | null;
  vaccinationsDueCount: number;
  hasRiskAssessment: boolean;
}

/** Prevention-side counterpart of getPatientSummaryStats — powers the
 * healthy-patient (dual-state) overview. All reads are RLS-scoped. */
export async function getPatientPreventionStats(
  patientId: string
): Promise<PatientPreventionStats> {
  const supabase = await createClient();

  const [
    { count: activePlans },
    { data: dueScreenings },
    { count: dueVaccinations },
    { count: riskScores },
  ] = await Promise.all([
    supabase
      .from("care_plans")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .eq("status", "active"),
    supabase
      .from("screening_schedules")
      .select("due_date, screen_type:screen_types(name)")
      .eq("patient_id", patientId)
      .in("status", ["pending", "overdue"])
      .order("due_date", { ascending: true }),
    supabase
      .from("vaccination_schedules")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .in("status", ["pending", "overdue"]),
    supabase
      .from("prevention_risk_scores")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", patientId),
  ]);

  const next = dueScreenings?.[0] ?? null;

  return {
    hasActiveCarePlan: (activePlans ?? 0) > 0,
    screeningsDueCount: dueScreenings?.length ?? 0,
    nextScreening: next
      ? { name: next.screen_type?.name ?? "Screening", dueDate: next.due_date }
      : null,
    vaccinationsDueCount: dueVaccinations ?? 0,
    hasRiskAssessment: (riskScores ?? 0) > 0,
  };
}
