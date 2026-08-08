import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Full-record read for a patient's FHIR export — deliberately NOT the
 * Health Passport's trailing-12-month period query (get-health-passport-data.ts):
 * this is "take your whole record and leave," not a periodic summary.
 *
 * Every query below is scoped to the caller's own RLS session (a patient
 * reading their own patient_id) — the same authorization basis the
 * existing CSV/PDF exports already use, no new consent primitive needed
 * for self-export.
 *
 * DELIBERATELY EXCLUDED FROM v1, enumerated here so the boundary is
 * grep-able rather than tribal knowledge:
 *   - mental_health_screens, obesity_ed_screens: sensitive screening-tool
 *     results; also excluded from screening_results export below via the
 *     screen_types.sensitive flag, for any screen type added later.
 *   - patient_pregnancy, reproductive_health_profiles: sensitive singleton
 *     state.
 *   - referrals (non-clinical refer-a-friend rewards — not the same table
 *     as specialist_referrals, which IS in scope conceptually but not yet
 *     built into this v1's Observation/CarePlan set), chronic_condition_programmes,
 *     condition_protocols, pharmacy_medications: catalogues/programme
 *     definitions, not per-patient data.
 * None of this is permanent — each needs an explicit product decision
 * before it leaves the platform in a patient-downloadable file, not a
 * silent forever-omission.
 */
export interface FhirExportData {
  profile: {
    id: string;
    full_name: string | null;
    date_of_birth: string | null;
    sex: Database["public"]["Enums"]["sex"] | null;
    phone: string | null;
    patient_number: string | null;
  };
  vitals: Database["public"]["Tables"]["vitals_readings"]["Row"][];
  bloodProfile: Database["public"]["Tables"]["patient_blood_profile"]["Row"] | null;
  screenings: {
    row: Database["public"]["Tables"]["screening_results"]["Row"];
    screenTypeName: string;
  }[];
  allergies: Database["public"]["Tables"]["patient_allergies"]["Row"][];
  medications: Database["public"]["Tables"]["medications"]["Row"][];
  immunizations: {
    row: Database["public"]["Tables"]["vaccination_records"]["Row"];
    vaccineName: string;
  }[];
  carePlans: Database["public"]["Tables"]["care_plans"]["Row"][];
  hospitalAdmissions: Database["public"]["Tables"]["patient_hospital_admissions"]["Row"][];
  documents: Database["public"]["Tables"]["lab_result_documents"]["Row"][];
}

export async function getFhirExportData(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<FhirExportData> {
  const [
    profileResult,
    vitalsResult,
    bloodProfileResult,
    screeningsResult,
    allergiesResult,
    medicationsResult,
    immunizationsResult,
    carePlansResult,
    admissionsResult,
    documentsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, date_of_birth, sex, phone, patient_number")
      .eq("id", patientId)
      .single(),
    supabase
      .from("vitals_readings")
      .select("*")
      .eq("patient_id", patientId)
      .eq("organisation_id", organisationId)
      .order("taken_at", { ascending: false }),
    supabase.from("patient_blood_profile").select("*").eq("patient_id", patientId).maybeSingle(),
    supabase
      .from("screening_results")
      .select("*, screen_types(name, sensitive)")
      .eq("patient_id", patientId)
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("patient_allergies")
      .select("*")
      .eq("patient_id", patientId)
      .eq("organisation_id", organisationId)
      .order("noted_at", { ascending: false }),
    supabase
      .from("medications")
      .select("*")
      .eq("patient_id", patientId)
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("vaccination_records")
      .select("*, vaccination_catalog(name)")
      .eq("profile_id", patientId)
      .eq("organisation_id", organisationId)
      .eq("verification_status", "verified")
      .order("date_administered", { ascending: false }),
    supabase
      .from("care_plans")
      .select("*")
      .eq("patient_id", patientId)
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("patient_hospital_admissions")
      .select("*")
      .eq("patient_id", patientId)
      .eq("organisation_id", organisationId)
      .order("admitted_on", { ascending: false }),
    supabase
      .from("lab_result_documents")
      .select("*")
      .eq("patient_id", patientId)
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
  ]);

  if (!profileResult.data) {
    throw new Error("Patient profile not found for FHIR export");
  }

  type ScreeningRow = Database["public"]["Tables"]["screening_results"]["Row"] & {
    screen_types: { name: string; sensitive: boolean } | null;
  };
  const screenings = ((screeningsResult.data ?? []) as ScreeningRow[])
    // Never export a sensitive screen type, regardless of which one it is
    // or when it was added — the allow-by-default direction would be the
    // dangerous one here.
    .filter((row) => row.screen_types?.sensitive !== true)
    .map((row) => ({ row, screenTypeName: row.screen_types?.name ?? row.screen_type_code ?? "Screening" }));

  type ImmunizationRow = Database["public"]["Tables"]["vaccination_records"]["Row"] & {
    vaccination_catalog: { name: string } | null;
  };
  const immunizations = ((immunizationsResult.data ?? []) as ImmunizationRow[]).map((row) => ({
    row,
    vaccineName: row.vaccination_catalog?.name ?? "Vaccine",
  }));

  return {
    profile: profileResult.data,
    vitals: vitalsResult.data ?? [],
    bloodProfile: bloodProfileResult.data ?? null,
    screenings,
    allergies: allergiesResult.data ?? [],
    medications: medicationsResult.data ?? [],
    immunizations,
    carePlans: carePlansResult.data ?? [],
    hospitalAdmissions: admissionsResult.data ?? [],
    documents: documentsResult.data ?? [],
  };
}
