import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { EmergencyClinicalFacts } from "./card";

/**
 * Assembles the SAME clinical facts as `public.emergency_card_by_token`, but
 * sourced through the PATIENT'S OWN authenticated session rather than the anon
 * RPC — deliberately.
 *
 * This is what makes the printed/offline card the default with ZERO new
 * anon-readable surface: a patient viewing and printing their own record needs
 * no more authorisation than Health Passport already needs, because every
 * table read here (`profiles`, `patient_allergies`, `medications`,
 * `care_plans`, `patient_blood_profile`) already has RLS admitting the
 * patient's own row. There is nothing to consent to beyond what already
 * governs viewing your own data.
 *
 * Kept structurally in sync with the SQL function by comment rather than
 * shared code — one is SQL, one is TypeScript, and they are independently
 * maintained. If a field is added to one, add it to the other.
 */
export async function loadEmergencyDatasetForPatient(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<EmergencyClinicalFacts> {
  const [{ data: profile }, { data: allergies }, { data: medications }, { data: carePlans }, { data: blood }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "full_name, date_of_birth, sex, patient_number, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship",
        )
        .eq("id", patientId)
        .maybeSingle(),
      supabase
        .from("patient_allergies")
        .select("allergen, reaction, severity")
        .eq("patient_id", patientId)
        .order("severity", { ascending: false, nullsFirst: false })
        .order("allergen"),
      supabase
        .from("medications")
        .select("drug_name, dose, frequency")
        .eq("patient_id", patientId)
        .eq("is_active", true)
        .order("drug_name"),
      supabase.from("care_plans").select("condition").eq("patient_id", patientId).eq("status", "active"),
      supabase
        .from("patient_blood_profile")
        .select("blood_group, genotype, genotype_note, provenance, recorded_at")
        .eq("patient_id", patientId)
        .maybeSingle(),
    ]);

  return {
    full_name: profile?.full_name ?? null,
    date_of_birth: profile?.date_of_birth ?? null,
    sex: profile?.sex ?? null,
    patient_number: profile?.patient_number ?? null,
    emergency_contact: profile?.emergency_contact_name
      ? {
          name: profile.emergency_contact_name,
          phone: profile.emergency_contact_phone,
          relationship: profile.emergency_contact_relationship,
        }
      : null,
    allergies: allergies ?? [],
    medications: medications ?? [],
    conditions: [...new Set((carePlans ?? []).map((c) => c.condition as string))],
    blood: blood
      ? {
          blood_group: blood.blood_group,
          genotype: blood.genotype,
          note: blood.genotype_note,
          provenance: blood.provenance,
          recorded_at: blood.recorded_at,
        }
      : null,
  };
}
