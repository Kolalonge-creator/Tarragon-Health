import { createClient } from "@/lib/supabase/server";
import { todayIsoDate } from "@/lib/queries/medications";
import { buildTodaysDoseChecklist } from "@/lib/medication-schedule/checklist";

export interface PatientSummaryStats {
  latestBp: { systolic: number; diastolic: number } | null;
  latestGlucoseMmolL: number | null;
  activeMedicationCount: number;
  dosesTaken: number;
  dosesTotal: number;
  /** Whether this patient has ever logged a reading of ANY type. latestBp and
   * latestGlucoseMmolL between them only cover two of the eight vital types,
   * so neither being present is not the same as "has logged nothing" -- a
   * patient who has only ever recorded their weight would read as brand new.
   * Drives the Overview's first-run state, so it has to mean what it says. */
  hasAnyVitals: boolean;
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
      // medication_logs is append-only (20260830224528) — a slot can carry
      // more than one row once corrected, so read the latest-per-slot view.
      supabase
        .from("medication_logs_latest_per_slot")
        .select("medication_id, scheduled_time, status")
        .eq("patient_id", patientId)
        .eq("scheduled_for_date", today),
    ]);

  // head + exact count: asks "does even one row exist" without transferring
  // any of them, and without a limit(1) that would make a genuine failure
  // (null) indistinguishable from an empty table.
  const { count: vitalsCount } = await supabase
    .from("vitals_readings")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId);

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
    // A failed count must not read as "brand new" and wipe a real patient's
    // dashboard down to a get-started card, so null falls the safe way.
    hasAnyVitals: vitalsCount === null ? true : vitalsCount > 0,
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
  /**
   * Any signal — clinician-recorded or self-reported — that this patient has
   * an ongoing condition to manage, as opposed to a purely preventive account
   * with nothing yet to monitor. `hasActiveCarePlan` alone under-counts this:
   * a care plan is clinician-created, so a patient is never chronic by this
   * measure before a clinician has acted, even the moment they self-report an
   * existing diagnosis on their own health profile. Checked, in order of how
   * early each can appear in a patient's lifecycle: the self-reported
   * `existing_diagnoses` answer on the risk assessment (available from minute
   * one, before any clinician has seen the patient), an open `patient_conditions`
   * problem-list entry, an active care plan, and a live chronic-programme
   * enrolment. Drives whether the Get Started checklist (get-started-card.tsx)
   * asks for a reading/medications at all — those two steps are just
   * unreachable busywork for a genuinely healthy account.
   */
  hasChronicCondition: boolean;
}

/** condition_clinical_status values that mean "still open" — excludes
 * 'resolved'/'historical', which describe a condition no longer being
 * actively managed and so shouldn't pull a patient into the chronic-steps
 * checklist. */
const OPEN_CONDITION_STATUSES = [
  "suspected",
  "under_investigation",
  "active",
  "controlled",
  "uncontrolled",
] as const;

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
    { count: openConditions },
    { count: activeEnrolments },
    { data: existingDiagnosesRow },
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
    supabase
      .from("patient_conditions")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .in("status", OPEN_CONDITION_STATUSES),
    supabase
      .from("chronic_programme_enrolments")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", patientId)
      .eq("status", "enrolled"),
    // No unique constraint on (profile_id, question_key) — retaking the
    // assessment keeps history rather than upserting — so the latest answer
    // is whichever row was created most recently.
    supabase
      .from("risk_assessment_responses")
      .select("response")
      .eq("profile_id", patientId)
      .eq("question_key", "existing_diagnoses")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const next = dueScreenings?.[0] ?? null;
  const selfReportedDiagnoses = Array.isArray(existingDiagnosesRow?.response)
    ? (existingDiagnosesRow.response as unknown[])
    : [];

  return {
    hasActiveCarePlan: (activePlans ?? 0) > 0,
    screeningsDueCount: dueScreenings?.length ?? 0,
    nextScreening: next
      ? { name: next.screen_type?.name ?? "Screening", dueDate: next.due_date }
      : null,
    vaccinationsDueCount: dueVaccinations ?? 0,
    hasRiskAssessment: (riskScores ?? 0) > 0,
    hasChronicCondition:
      selfReportedDiagnoses.length > 0 ||
      (openConditions ?? 0) > 0 ||
      (activePlans ?? 0) > 0 ||
      (activeEnrolments ?? 0) > 0,
  };
}
