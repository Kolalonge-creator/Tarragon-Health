import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { egfrFromReading, type EgfrWithProvenance } from "@/lib/rules/egfr";
import {
  assessMedicationSafety,
  type MedicationInput,
  type SafetyReport,
} from "@/lib/rules/drug-safety";
import { analyseRecord, type TrendFinding } from "@/lib/rules/longitudinal";

/**
 * Assembles the two things the new clinical engines need from the record, in
 * one place, so the clinician view and the patient view can never disagree
 * about a patient's eGFR or their trends.
 *
 * Every read goes through the CALLER'S OWN Supabase client, so RLS is the
 * authorisation gate exactly as it is everywhere else — this module adds no
 * privilege of its own.
 */

/** How far back to look for readings that feed a trend. */
const TREND_LOOKBACK_YEARS = 5;

export interface PatientClinicalContext {
  egfr: EgfrWithProvenance | null;
  /** Why eGFR is unavailable, when it is. Surfaced, never silently absent. */
  egfrUnavailableReason: string | null;
  trends: TrendFinding[];
}

export async function loadPatientClinicalContext(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<PatientClinicalContext> {
  const since = new Date();
  since.setFullYear(since.getFullYear() - TREND_LOOKBACK_YEARS);

  const [{ data: patient }, { data: readings }] = await Promise.all([
    supabase.from("profiles").select("date_of_birth, sex").eq("id", patientId).maybeSingle(),
    supabase
      .from("lab_analyte_readings")
      .select("code, value, taken_at")
      .eq("patient_id", patientId)
      .gte("taken_at", since.toISOString())
      .order("taken_at", { ascending: true }),
  ]);

  // lab_analyte_readings now also holds NON-NUMERIC results (a genotype, a
  // malaria film, a urine dipstick), which carry value_text and a null value.
  // Every engine below is numeric, so those rows are excluded here rather than
  // coerced — a genotype has no place in a trend line or an eGFR.
  const numericReadings = (readings ?? []).filter(
    (r): r is typeof r & { value: number } => r.value !== null,
  );

  const trends = analyseRecord(
    numericReadings.map((r) => ({ code: r.code, value: r.value, takenAt: r.taken_at })),
    { sex: patient?.sex ?? null },
  );

  const { egfr, egfrUnavailableReason } = deriveEgfr(numericReadings, patient ?? null);

  return { egfr, egfrUnavailableReason, trends };
}

function deriveEgfr(
  readings: { code: string; value: number; taken_at: string }[],
  patient: { date_of_birth: string | null; sex: string | null } | null,
): { egfr: EgfrWithProvenance | null; egfrUnavailableReason: string | null } {
  const creatinines = readings.filter((r) => r.code === "creatinine");
  const latest = creatinines[creatinines.length - 1];

  if (!latest) {
    return {
      egfr: null,
      egfrUnavailableReason:
        "No creatinine result is on file. Record a kidney function test to switch on renal dosing checks.",
    };
  }
  if (!patient?.date_of_birth || !patient.sex) {
    return {
      egfr: null,
      egfrUnavailableReason:
        "eGFR needs the patient's date of birth and sex on file. Add them to switch on renal dosing checks.",
    };
  }

  const egfr = egfrFromReading({
    creatinineMgDl: latest.value,
    takenAt: latest.taken_at,
    dateOfBirth: patient.date_of_birth,
    sex: patient.sex,
  });

  if (!egfr) {
    return {
      egfr: null,
      // The commonest real cause is a paediatric patient — CKD-EPI is an adult
      // equation and egfrFromReading deliberately refuses rather than mis-apply it.
      egfrUnavailableReason:
        "An eGFR could not be estimated from the creatinine on file. The adult equation does not apply under 18.",
    };
  }
  return { egfr, egfrUnavailableReason: null };
}

export interface MedicationSafetyView {
  report: SafetyReport;
  egfr: EgfrWithProvenance | null;
  egfrUnavailableReason: string | null;
  medicationCount: number;
}

/**
 * The full medication safety picture for a patient: their active medicines,
 * checked against each other and against their own kidney function.
 */
export async function loadMedicationSafety(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<MedicationSafetyView> {
  const context = await loadPatientClinicalContext(supabase, patientId);

  const { data: medications } = await supabase
    .from("medications")
    .select("id, drug_name, dose, prescriber_name, source")
    .eq("patient_id", patientId)
    .eq("is_active", true);

  const inputs: MedicationInput[] = (medications ?? []).map((m) => ({
    id: m.id,
    drugName: m.drug_name,
    dose: m.dose,
    prescriberName: m.prescriber_name,
    source: m.source,
  }));

  const report = assessMedicationSafety(inputs, {
    egfr: context.egfr?.egfr ?? null,
    egfrStale: context.egfr?.stale ?? false,
  });

  return {
    report,
    egfr: context.egfr,
    egfrUnavailableReason: context.egfrUnavailableReason,
    medicationCount: inputs.length,
  };
}
