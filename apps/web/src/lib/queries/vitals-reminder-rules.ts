import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { VitalsReminderRuleInput } from "@/lib/validation/vitals-reminder-rules";

export type VitalsReminderRule = Tables<"vitals_reminder_rules"> & {
  patient: { full_name: string | null; phone: string | null } | null;
};

const QUERY_KEY = ["vitals-reminder-rules"];

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

export function useVitalsReminderRules() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vitals_reminder_rules")
        .select(
          "*, patient:profiles!vitals_reminder_rules_patient_id_fkey(full_name, phone)"
        )
        .order("patient_id", { ascending: true, nullsFirst: true })
        .order("condition", { ascending: true, nullsFirst: true });
      if (error) throw error;
      return data as VitalsReminderRule[];
    },
  });
}

/**
 * Not a blind `.upsert()`: the three scopes are enforced by partial unique
 * indexes (organisation_id, patient_id/condition), and supabase-js's
 * `onConflict` targets a plain column list, not a partial-index predicate —
 * so it can't map cleanly onto three different partial indexes. Instead,
 * find any existing row for the given scope and branch update/insert.
 */
export function useUpsertVitalsReminderRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VitalsReminderRuleInput) => {
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
          .from("vitals_reminder_rules")
          .select("id")
          .eq("organisation_id", organisation_id)
          .eq("patient_id", patient.id)
          .maybeSingle();

        const { error } = existing
          ? await supabase
              .from("vitals_reminder_rules")
              .update({ frequency_days: input.frequency_days })
              .eq("id", existing.id)
          : await supabase.from("vitals_reminder_rules").insert({
              organisation_id,
              patient_id: patient.id,
              frequency_days: input.frequency_days,
            });
        if (error) throw error;
        return;
      }

      if (input.scope === "condition") {
        const { data: existing } = await supabase
          .from("vitals_reminder_rules")
          .select("id")
          .eq("organisation_id", organisation_id)
          .is("patient_id", null)
          .eq("condition", input.condition)
          .maybeSingle();

        const { error } = existing
          ? await supabase
              .from("vitals_reminder_rules")
              .update({ frequency_days: input.frequency_days })
              .eq("id", existing.id)
          : await supabase.from("vitals_reminder_rules").insert({
              organisation_id,
              condition: input.condition,
              frequency_days: input.frequency_days,
            });
        if (error) throw error;
        return;
      }

      const { data: existing } = await supabase
        .from("vitals_reminder_rules")
        .select("id")
        .eq("organisation_id", organisation_id)
        .is("patient_id", null)
        .is("condition", null)
        .maybeSingle();

      const { error } = existing
        ? await supabase
            .from("vitals_reminder_rules")
            .update({ frequency_days: input.frequency_days })
            .eq("id", existing.id)
        : await supabase
            .from("vitals_reminder_rules")
            .insert({ organisation_id, frequency_days: input.frequency_days });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useDeleteVitalsReminderRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("vitals_reminder_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
