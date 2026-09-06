import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { LogScreeningCompletionInput } from "@/lib/validation/screening-completion";
import type { DeclineScreeningInput } from "@/lib/validation/screening-decline";

export type ScreeningSchedule = Tables<"screening_schedules"> & {
  screen_type: { name: string; code: string } | null;
};

export function screeningSchedulesKey(patientId: string) {
  return ["screening-schedules", patientId];
}

export function useScreeningSchedules(patientId: string) {
  return useQuery({
    queryKey: screeningSchedulesKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("screening_schedules")
        .select("*, screen_type:screen_types(name, code)")
        .eq("patient_id", patientId)
        .neq("status", "cancelled")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as ScreeningSchedule[];
    },
    enabled: !!patientId,
  });
}

/**
 * Patient self-reports a due screening as done, with the date it was
 * actually performed. Writes through the patient's own RLS-scoped session
 * (screening_completions is patient-insert-own, same trust level as
 * vaccination_records); the private.refresh_screening_schedule_on_completion
 * trigger closes the matching schedule row and schedules the next cycle from
 * performed_date — not from today, and not a fixed cadence — mirroring
 * generateVaccinationScheduleBestEffort's "next dose off the logged date"
 * contract. Returns the new completion id so the caller can immediately link
 * an uploaded result document to it (see useUploadOwnResultDocument).
 */
export function useLogScreeningCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: LogScreeningCompletionInput & { patientId: string }
    ): Promise<string> => {
      const supabase = createClient();
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", input.patientId)
        .single();
      if (profileError) throw profileError;
      if (!profile?.organisation_id) {
        throw new Error("This patient has no organisation on file");
      }

      const { patientId, schedule_id, note, ...rest } = input;
      const { data, error } = await supabase
        .from("screening_completions")
        .insert({
          ...rest,
          patient_id: patientId,
          organisation_id: profile.organisation_id,
          schedule_id: schedule_id ?? null,
          note: note?.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: screeningSchedulesKey(variables.patientId) });
    },
  });
}

/**
 * Patient declines a recommended screening, with a reason. Writes through
 * the patient's own RLS-scoped session (screening_schedules_update already
 * permits the owning patient to update their own row); the DB CHECK
 * constraint screening_schedules_declined_requires_reason keeps status and
 * declined_at/declined_reason consistent, and
 * private.block_screening_schedule_after_decline stops the recommendation
 * engine or any refresh trigger from silently reopening this screen type
 * afterwards.
 */
export function useDeclineScreeningSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeclineScreeningInput & { patientId: string }): Promise<void> => {
      const supabase = createClient();
      const { error } = await supabase
        .from("screening_schedules")
        .update({
          status: "declined",
          declined_at: new Date().toISOString(),
          declined_reason: input.reason,
        })
        .eq("id", input.schedule_id)
        .eq("patient_id", input.patientId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: screeningSchedulesKey(variables.patientId) });
    },
  });
}
