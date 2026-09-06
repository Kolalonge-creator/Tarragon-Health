import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type {
  CreatePatientReminderGroupInput,
  SetReminderFrequencyInput,
} from "@/lib/validation/patient-reminder-groups";

export type PatientReminderGroup = Tables<"patient_reminder_groups"> & {
  member_count: number;
};

const GROUPS_QUERY_KEY = ["patient-reminder-groups"];
const RULES_QUERY_KEY = ["clinician-reminder-rules"];

async function getCurrentUserOrganisationId(): Promise<string> {
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
    throw new Error("This account has no organisation on file");
  }
  return profile.organisation_id;
}

/**
 * Groups are org-shared (any clinician may see/edit any group in their org —
 * see 20260830224511_patient_reminder_groups.sql), not owned exclusively by
 * whoever created one.
 */
export function usePatientReminderGroups() {
  return useQuery({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_reminder_groups")
        .select("*, patient_reminder_group_members(count)")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const { patient_reminder_group_members, ...group } = row as Tables<"patient_reminder_groups"> & {
          patient_reminder_group_members: { count: number }[];
        };
        return {
          ...group,
          member_count: patient_reminder_group_members?.[0]?.count ?? 0,
        };
      }) as PatientReminderGroup[];
    },
  });
}

export function useCreatePatientReminderGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePatientReminderGroupInput) => {
      const supabase = createClient();
      const organisation_id = await getCurrentUserOrganisationId();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("patient_reminder_groups")
        .insert({ organisation_id, name: input.name, created_by: user?.id ?? null })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
    },
  });
}

export function useAddPatientsToGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, patientIds }: { groupId: string; patientIds: string[] }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("patient_reminder_group_members")
        .upsert(
          patientIds.map((patient_id) => ({ group_id: groupId, patient_id })),
          { onConflict: "group_id,patient_id", ignoreDuplicates: true }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
    },
  });
}

/**
 * Not a blind `.upsert()`, same reason as useUpsertVitalsReminderRule: the
 * three scopes are enforced by partial unique indexes and supabase-js's
 * `onConflict` can't target a partial-index predicate.
 */
export function useSetPatientReminderFrequency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      frequencyDays,
    }: { patientId: string } & { frequencyDays: SetReminderFrequencyInput["frequency_days"] }) => {
      const supabase = createClient();
      const organisation_id = await getCurrentUserOrganisationId();

      const { data: existing } = await supabase
        .from("vitals_reminder_rules")
        .select("id")
        .eq("organisation_id", organisation_id)
        .eq("patient_id", patientId)
        .maybeSingle();

      const { error } = existing
        ? await supabase
            .from("vitals_reminder_rules")
            .update({ frequency_days: frequencyDays })
            .eq("id", existing.id)
        : await supabase
            .from("vitals_reminder_rules")
            .insert({ organisation_id, patient_id: patientId, frequency_days: frequencyDays });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY });
    },
  });
}

export function useSetGroupReminderFrequency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      groupId,
      frequencyDays,
    }: { groupId: string } & { frequencyDays: SetReminderFrequencyInput["frequency_days"] }) => {
      const supabase = createClient();
      const organisation_id = await getCurrentUserOrganisationId();

      const { data: existing } = await supabase
        .from("vitals_reminder_rules")
        .select("id")
        .eq("organisation_id", organisation_id)
        .eq("group_id", groupId)
        .maybeSingle();

      const { error } = existing
        ? await supabase
            .from("vitals_reminder_rules")
            .update({ frequency_days: frequencyDays })
            .eq("id", existing.id)
        : await supabase
            .from("vitals_reminder_rules")
            .insert({ organisation_id, group_id: groupId, frequency_days: frequencyDays });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RULES_QUERY_KEY });
    },
  });
}

/** The reminder rule (if any) currently on file for a set of patients, keyed by patient_id. */
export function usePatientReminderRules(patientIds: string[]) {
  return useQuery({
    queryKey: [...RULES_QUERY_KEY, ...patientIds].sort(),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("vitals_reminder_rules")
        .select("id, patient_id, group_id, frequency_days")
        .in("patient_id", patientIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: patientIds.length > 0,
  });
}
