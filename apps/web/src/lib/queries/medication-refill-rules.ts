import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { MedicationRefillRuleInput } from "@/lib/validation/medication-refill-rules";

export type MedicationRefillRule = Tables<"medication_refill_reminder_rules"> & {
  patient: { full_name: string | null; phone: string | null } | null;
};

const QUERY_KEY = ["medication-refill-rules"];

async function getAdminOrganisationId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    throw new Error("This admin account has no organisation on file");
  }
  return profile.organisation_id;
}

export function useMedicationRefillRules() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_refill_reminder_rules")
        .select(
          "*, patient:profiles!medication_refill_reminder_rules_patient_id_fkey(full_name, phone)"
        )
        .order("patient_id", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return data as MedicationRefillRule[];
    },
  });
}

/**
 * Select-then-branch instead of a blind `.upsert()` — the two scopes are
 * enforced by partial unique indexes that supabase-js's `onConflict` can't
 * target directly, same rationale as the vitals reminder rules.
 */
export function useUpsertMedicationRefillRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MedicationRefillRuleInput) => {
      const supabase = createClient();
      const organisation_id = await getAdminOrganisationId();

      if (input.scope === "patient") {
        const { data: patient, error: patientError } = await supabase
          .from("profiles")
          .select("id")
          .eq("phone", input.patient_phone)
          .eq("role", "patient")
          .maybeSingle();
        if (patientError) throw patientError;
        if (!patient) throw new Error("No patient found with that phone number");

        const { data: existing } = await supabase
          .from("medication_refill_reminder_rules")
          .select("id")
          .eq("organisation_id", organisation_id)
          .eq("patient_id", patient.id)
          .maybeSingle();

        const { error } = existing
          ? await supabase
              .from("medication_refill_reminder_rules")
              .update({ lead_days: input.lead_days })
              .eq("id", existing.id)
          : await supabase.from("medication_refill_reminder_rules").insert({
              organisation_id,
              patient_id: patient.id,
              lead_days: input.lead_days,
            });
        if (error) throw error;
        return;
      }

      const { data: existing } = await supabase
        .from("medication_refill_reminder_rules")
        .select("id")
        .eq("organisation_id", organisation_id)
        .is("patient_id", null)
        .maybeSingle();

      const { error } = existing
        ? await supabase
            .from("medication_refill_reminder_rules")
            .update({ lead_days: input.lead_days })
            .eq("id", existing.id)
        : await supabase
            .from("medication_refill_reminder_rules")
            .insert({ organisation_id, lead_days: input.lead_days });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useDeleteMedicationRefillRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_refill_reminder_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
