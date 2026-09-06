import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type PatientAllergy = Tables<"patient_allergies">;

const allergiesKey = (patientId: string) => ["patient-allergies", patientId] as const;

/**
 * Patient's allergy list (spec §76.3 / §1.8,
 * 20260716121000_patient_allergies.sql) — the first reader of
 * `patient_allergies` anywhere in the app. Unlike patient_conditions, RLS
 * gives the patient full CRUD on their own rows here (a self-reported
 * allergen is safety data the patient owns, not a restricted diagnosis), so
 * this file also exports useAddAllergy below. Ordered most-recently-noted
 * first.
 */
export function useAllergies(patientId: string) {
  return useQuery({
    queryKey: allergiesKey(patientId),
    queryFn: async (): Promise<PatientAllergy[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_allergies")
        .select("*")
        .eq("patient_id", patientId)
        .order("noted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!patientId,
  });
}

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const addAllergyInputSchema = z.object({
  patientId: z.string().uuid(),
  allergen: z.string().trim().min(1, "Please name the allergen").max(200),
  reaction: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  severity: z.preprocess(
    emptyToUndefined,
    z.enum(["mild", "moderate", "severe"]).optional()
  ),
});

export type AddAllergyInput = z.input<typeof addAllergyInputSchema>;

/**
 * Self-reported allergy add. `patient_allergies_insert` RLS lets
 * `patient_id = auth.uid()` insert outright (see the migration referenced
 * above), so this never needs org-staff involvement — `source` is always
 * written as 'patient' here; a clinician-recorded allergy is a separate,
 * org-staff-side write path this hook does not cover. The caller only ever
 * has `patientId` in hand (ConditionsList/AllergiesList's shared prop
 * shape), so organisation_id is resolved here from the patient's own
 * `profiles` row rather than threaded in from the page — the same read
 * every patient-dashboard route already has RLS access to.
 */
export function useAddAllergy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rawInput: AddAllergyInput): Promise<void> => {
      const input = addAllergyInputSchema.parse(rawInput);
      const supabase = createClient();

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", input.patientId)
        .single();
      if (profileError || !profile?.organisation_id) {
        throw new Error("Could not find your organisation on file");
      }

      const { error } = await supabase.from("patient_allergies").insert({
        organisation_id: profile.organisation_id,
        patient_id: input.patientId,
        allergen: input.allergen,
        reaction: input.reaction ?? null,
        severity: input.severity ?? null,
        source: "patient",
      });
      if (error) throw error;
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: allergiesKey(variables.patientId) });
    },
  });
}
