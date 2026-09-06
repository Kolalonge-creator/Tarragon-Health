import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Full structured patient record export — spec §34.17 ("complete record
 * where appropriate") / §34.18 (data portability: "If a patient leaves
 * Tarragon, their health information should not become trapped inside the
 * platform").
 *
 * DELIBERATELY SEPARATE FROM getHealthPassportData
 * (lib/health-passport/get-health-passport-data.ts): that function is an
 * explicitly BOUNDED, summarised read-side view (12-month window, latest-
 * per-vital-type only, no conditions/allergies/medications) — its own page
 * says outright "Not a substitute for your full medical record." This
 * function is that full record: every vitals/lab reading (not just the
 * latest), every diagnosis/allergy/medication row, unbounded by time
 * window. It reuses nothing from Health Passport because the shapes don't
 * overlap enough to share code without distorting one or the other.
 *
 * SCOPE: every table already covered by this MDM build's own concept-link/
 * provenance work (patient_conditions, patient_allergies, medications) plus
 * the other core clinical tables. Not a literal export of all ~100 patient-
 * scoped tables on the platform — this is the record a patient or another
 * clinician would actually want (diagnoses, allergies, medications, vitals,
 * labs, screenings, care plans, identity), not internal ops rows
 * (subscription billing, wellness points, referral commissions, ...).
 *
 * ACCESS: every query below is scoped to `patientId` and run on the
 * CALLER's own RLS-scoped session client — this must only ever be called
 * with a client authenticated as that same patient (or an org-staff/admin
 * session with legitimate access), never a service-role client on someone
 * else's behalf. The API route enforces the "own record only" half of
 * that; RLS enforces the rest.
 */

export interface FullPatientRecordExport {
  exportedAt: string;
  patient: {
    id: string;
    patientNumber: string | null;
    fullName: string | null;
    phone: string | null;
    sex: string | null;
    dateOfBirth: string | null;
    state: string | null;
    city: string | null;
    area: string | null;
    language: string;
    emergencyContact: {
      name: string | null;
      phone: string | null;
      relationship: string | null;
    };
  };
  conditions: Database["public"]["Tables"]["patient_conditions"]["Row"][];
  allergies: Database["public"]["Tables"]["patient_allergies"]["Row"][];
  medications: Database["public"]["Tables"]["medications"]["Row"][];
  vitals: Database["public"]["Tables"]["vitals_readings"]["Row"][];
  labReadings: Database["public"]["Tables"]["lab_analyte_readings"]["Row"][];
  screeningResults: {
    screenTypeName: string | null;
    resultStatus: string | null;
    resultSummary: string | null;
    createdAt: string;
  }[];
  carePlans: Database["public"]["Tables"]["care_plans"]["Row"][];
}

export async function getFullPatientRecordExport(
  supabase: SupabaseClient<Database>,
  patientId: string
): Promise<FullPatientRecordExport> {
  const [
    profileRes,
    conditionsRes,
    allergiesRes,
    medicationsRes,
    vitalsRes,
    labRes,
    screeningRes,
    carePlansRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, patient_number, full_name, phone, sex, date_of_birth, state, city, area, language, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship"
      )
      .eq("id", patientId)
      .single(),
    supabase.from("patient_conditions").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }),
    supabase.from("patient_allergies").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }),
    supabase.from("medications").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }),
    supabase.from("vitals_readings").select("*").eq("patient_id", patientId).order("taken_at", { ascending: false }),
    supabase.from("lab_analyte_readings").select("*").eq("patient_id", patientId).order("taken_at", { ascending: false }),
    supabase
      .from("screening_schedules")
      .select("status, due_date, screen_types(name), screening_results(result_status, result_summary, created_at)")
      .eq("patient_id", patientId),
    supabase.from("care_plans").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (conditionsRes.error) throw conditionsRes.error;
  if (allergiesRes.error) throw allergiesRes.error;
  if (medicationsRes.error) throw medicationsRes.error;
  if (vitalsRes.error) throw vitalsRes.error;
  if (labRes.error) throw labRes.error;
  if (screeningRes.error) throw screeningRes.error;
  if (carePlansRes.error) throw carePlansRes.error;

  const profile = profileRes.data;

  return {
    exportedAt: new Date().toISOString(),
    patient: {
      id: profile.id,
      patientNumber: profile.patient_number,
      fullName: profile.full_name,
      phone: profile.phone,
      sex: profile.sex,
      dateOfBirth: profile.date_of_birth,
      state: profile.state,
      city: profile.city,
      area: profile.area,
      language: profile.language,
      emergencyContact: {
        name: profile.emergency_contact_name,
        phone: profile.emergency_contact_phone,
        relationship: profile.emergency_contact_relationship,
      },
    },
    conditions: conditionsRes.data ?? [],
    allergies: allergiesRes.data ?? [],
    medications: medicationsRes.data ?? [],
    vitals: vitalsRes.data ?? [],
    labReadings: labRes.data ?? [],
    screeningResults: (screeningRes.data ?? []).map((s) => {
      const screenType = s.screen_types as unknown as { name: string } | null;
      const results = s.screening_results as unknown as
        | { result_status: string | null; result_summary: string | null; created_at: string }[]
        | null;
      const latest = results && results.length > 0 ? results[0] : null;
      return {
        screenTypeName: screenType?.name ?? null,
        resultStatus: latest?.result_status ?? null,
        resultSummary: latest?.result_summary ?? null,
        createdAt: latest?.created_at ?? s.due_date,
      };
    }),
    carePlans: carePlansRes.data ?? [],
  };
}
