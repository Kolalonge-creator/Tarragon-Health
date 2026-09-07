import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables, Enums } from "@tarragon/shared";

export type PatientCondition = Tables<"patient_conditions">;
export type PatientAllergy = Tables<"patient_allergies">;
export type AllergySeverity = Enums<"allergy_severity">;

/**
 * Read-only problem list — mirrors apps/web/src/lib/queries/conditions.ts.
 * Only org clinical staff may insert/update a condition (RLS), so unlike
 * allergies there is no add path here.
 */
export async function loadConditions(patientId: string): Promise<QueryResult<PatientCondition[]>> {
  const { data, error } = await supabase
    .from("patient_conditions")
    .select("*")
    .eq("patient_id", patientId)
    .order("date_identified", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

/** Mirrors apps/web/src/lib/queries/allergies.ts's useAllergies. */
export async function loadAllergies(patientId: string): Promise<QueryResult<PatientAllergy[]>> {
  const { data, error } = await supabase
    .from("patient_allergies")
    .select("*")
    .eq("patient_id", patientId)
    .order("noted_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

/**
 * Self-reported allergy add — mirrors apps/web/src/lib/queries/
 * allergies.ts's useAddAllergy. `patient_allergies_insert` RLS lets
 * `patient_id = auth.uid()` insert outright, always with `source: 'patient'`;
 * a clinician-recorded allergy is a separate, org-staff-side write path this
 * does not cover. organisation_id is resolved from the patient's own
 * profiles row, same as web.
 */
export async function addAllergy(input: {
  patientId: string;
  allergen: string;
  reaction: string;
  severity: AllergySeverity | "";
}): Promise<QueryResult<null>> {
  const allergen = input.allergen.trim();
  if (!allergen) return { ok: false, error: "Please name the allergen" };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", input.patientId)
    .single();
  if (profileError || !profile?.organisation_id) {
    return { ok: false, error: "Could not find your organisation on file" };
  }

  const { error } = await supabase.from("patient_allergies").insert({
    organisation_id: profile.organisation_id,
    patient_id: input.patientId,
    allergen,
    reaction: input.reaction.trim() || null,
    severity: input.severity || null,
    source: "patient",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
