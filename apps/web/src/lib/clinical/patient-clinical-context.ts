import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { egfrFromReading, type EgfrWithProvenance } from "@/lib/rules/egfr";
import { combineKdigoRisk, type KdigoRiskResult } from "@/lib/rules/kdigo-ckd-risk";
import {
  assessMedicationSafety,
  type AllergyInput,
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
  /** KDIGO GFR x albuminuria combined risk category — null until both eGFR and a urine ACR are on file. */
  ckdRisk: KdigoRiskResult | null;
  /** Why ckdRisk is unavailable, when it is. Surfaced, never silently absent. */
  ckdRiskUnavailableReason: string | null;
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
  const { ckdRisk, ckdRiskUnavailableReason } = deriveCkdRisk(
    numericReadings,
    egfr,
    egfrUnavailableReason,
  );

  return { egfr, egfrUnavailableReason, ckdRisk, ckdRiskUnavailableReason, trends };
}

function deriveCkdRisk(
  readings: { code: string; value: number; taken_at: string }[],
  egfr: EgfrWithProvenance | null,
  egfrUnavailableReason: string | null,
): { ckdRisk: KdigoRiskResult | null; ckdRiskUnavailableReason: string | null } {
  if (!egfr) {
    return { ckdRisk: null, ckdRiskUnavailableReason: egfrUnavailableReason };
  }

  const acrReadings = readings.filter((r) => r.code === "urine_acr");
  const latestAcr = acrReadings[acrReadings.length - 1];
  if (!latestAcr) {
    return {
      ckdRisk: null,
      ckdRiskUnavailableReason:
        "No urine albumin-to-creatinine ratio on file. eGFR alone can miss a real risk that only shows up with albuminuria; add a urine ACR to complete the KDIGO CKD risk picture.",
    };
  }

  return {
    ckdRisk: combineKdigoRisk({ gfrCategory: egfr.category, acrMgG: latestAcr.value }),
    ckdRiskUnavailableReason: null,
  };
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
  ckdRisk: KdigoRiskResult | null;
  ckdRiskUnavailableReason: string | null;
  medicationCount: number;
  /** The patient's recorded allergies, for the UI to list independently of any finding firing. */
  allergies: AllergyInput[];
}

/**
 * The full medication safety picture for a patient: their active medicines,
 * checked against each other, against their own kidney function, and against
 * their recorded allergies.
 */
export async function loadMedicationSafety(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<MedicationSafetyView> {
  const context = await loadPatientClinicalContext(supabase, patientId);

  const [{ data: medications }, { data: allergyRows }] = await Promise.all([
    supabase
      .from("medications")
      .select("id, drug_name, dose, prescriber_name, source")
      .eq("patient_id", patientId)
      .eq("is_active", true),
    supabase
      .from("patient_allergies")
      .select("id, allergen, reaction, severity, source")
      .eq("patient_id", patientId)
      .order("allergen"),
  ]);

  const inputs: MedicationInput[] = (medications ?? []).map((m) => ({
    id: m.id,
    drugName: m.drug_name,
    dose: m.dose,
    prescriberName: m.prescriber_name,
    source: m.source,
  }));

  const allergies: AllergyInput[] = (allergyRows ?? []).map((a) => ({
    id: a.id,
    allergen: a.allergen,
    reaction: a.reaction,
    severity: a.severity,
    source: a.source,
  }));

  const report = assessMedicationSafety(inputs, {
    egfr: context.egfr?.egfr ?? null,
    egfrStale: context.egfr?.stale ?? false,
    allergies,
  });

  return {
    report,
    egfr: context.egfr,
    egfrUnavailableReason: context.egfrUnavailableReason,
    ckdRisk: context.ckdRisk,
    ckdRiskUnavailableReason: context.ckdRiskUnavailableReason,
    medicationCount: inputs.length,
    allergies,
  };
}
