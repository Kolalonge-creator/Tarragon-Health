import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

export type MedicationOutcomesSummary = {
  /** Clinician/specialist-sourced medications stopped in the window, with a recorded reason. */
  medsStoppedLast180Days: number;
  /** Distinct patients those stops belong to. */
  patientsWithStops: number;
  /** Patients with at least one bp_control risk score on record. */
  bpMonitoredCount: number;
  /** Of those, patients whose LATEST bp_control assessment is in range (low risk). */
  bpInRangeCount: number;
};

export const MEDICATION_OUTCOMES_DISCLAIMER =
  "Clinician-recorded medication stops and latest in-range BP assessments — engagement outcomes from the Tarragon record, not an insurance claims feed.";

const WINDOW_DAYS = 180;

/**
 * The Virta borrow: de-prescribing + control as B2B outcome evidence, derived
 * entirely from data the platform already stores. Deliberately honest labels:
 * a "stop" here is a clinician/specialist-sourced medication a doctor
 * recorded as stopped with a reason — never presented as "reversal", and
 * patient-added meds are excluded (stopping a self-logged row proves
 * nothing). BP control reads the existing bp_control risk scores (the ML
 * assessment already run on every BP log), latest per patient.
 */
export async function loadMedicationOutcomes(
  supabase: SupabaseClient<Database>,
  organisationId: string
): Promise<MedicationOutcomesSummary | null> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

  const [stops, bpScores] = await Promise.all([
    supabase
      .from("medications")
      .select("id, patient_id")
      .eq("organisation_id", organisationId)
      .in("source", ["clinician", "specialist"])
      .not("stopped_at", "is", null)
      .not("stopped_reason", "is", null)
      .gte("stopped_at", since),
    supabase
      .from("patient_risk_scores")
      .select("patient_id, risk_level, computed_at")
      .eq("organisation_id", organisationId)
      .eq("score_type", "bp_control")
      .order("computed_at", { ascending: false }),
  ]);

  if (stops.error || bpScores.error) return null;

  const stopRows = stops.data ?? [];
  const latestBpByPatient = new Map<string, string | null>();
  for (const row of bpScores.data ?? []) {
    if (!latestBpByPatient.has(row.patient_id)) {
      latestBpByPatient.set(row.patient_id, row.risk_level);
    }
  }

  let bpInRangeCount = 0;
  for (const level of latestBpByPatient.values()) {
    if (level === "low") bpInRangeCount += 1;
  }

  return {
    medsStoppedLast180Days: stopRows.length,
    patientsWithStops: new Set(stopRows.map((r) => r.patient_id)).size,
    bpMonitoredCount: latestBpByPatient.size,
    bpInRangeCount,
  };
}
