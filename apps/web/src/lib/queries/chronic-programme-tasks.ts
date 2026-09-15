import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type ChronicProgrammeCoordinatorTask = Tables<"chronic_programme_coordinator_tasks"> & {
  patient: { full_name: string | null; patient_number: string | null } | null;
  occurrence: { week_number: number; occurrence_type: string; due_date: string } | null;
};
export type ChronicCoordinatorTaskStatus = Enums<"chronic_coordinator_task_status">;

const TASKS_KEY = ["chronic-programme-coordinator-tasks"] as const;

/** Open Coordinator worklist for the 12-week programme's missed-occurrence
 * sweep (private.sweep_chronic_programme_occurrences) — logistics only,
 * never a clinical worklist (see the migration's own header on why this is
 * a dedicated table rather than care_plan_review_prompts). */
export function useChronicProgrammeCoordinatorTasks() {
  return useQuery({
    queryKey: TASKS_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("chronic_programme_coordinator_tasks")
        .select(
          "*, patient:profiles!chronic_programme_coordinator_tasks_patient_id_fkey(full_name, patient_number), occurrence:chronic_programme_schedule_occurrences(week_number, occurrence_type, due_date)"
        )
        .eq("status", "open")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ChronicProgrammeCoordinatorTask[];
    },
  });
}

export function useUpdateChronicProgrammeTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      status,
    }: {
      taskId: string;
      status: ChronicCoordinatorTaskStatus;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("chronic_programme_coordinator_tasks")
        .update({ status, done_by: user?.id ?? null, done_at: new Date().toISOString() })
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

/** Generates the actual lab order for a missed_lab_panel task — attributed
 * to the patient's assigned clinician server-side (public.
 * generate_chronic_programme_lab_order), never to the Coordinator calling
 * this, since a Coordinator has no ordering authority. */
export function useGenerateChronicProgrammeLabOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (occurrenceId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("generate_chronic_programme_lab_order", {
        p_occurrence_id: occurrenceId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}
