import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Json, Tables } from "@tarragon/shared";

export type CareTask = Tables<"care_tasks">;
export type CareTaskStatus = Enums<"care_task_status">;
export type CareTaskOwnerRole = Enums<"care_task_owner_role">;

export const careTaskKeys = {
  patient: (patientId: string) => ["care-tasks", "patient", patientId] as const,
};

/**
 * A patient's own care-plan tasks — same rows a clinician viewing that
 * patient sees (RLS covers both: patient_id = auth.uid() OR org staff).
 * Ungrouped on purpose; grouping into Today/This week/Upcoming/Overdue for
 * the dashboard is `groupCareTasksByBucket` (lib/rules/care-task-buckets.ts),
 * kept separate so it stays a plain, unit-testable function.
 */
export function useCareTasks(patientId: string | null) {
  return useQuery({
    queryKey: careTaskKeys.patient(patientId ?? ""),
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_tasks")
        .select("*")
        .eq("patient_id", patientId as string)
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as CareTask[];
    },
  });
}

/**
 * The ONLY way a patient moves their own task — care_tasks carries no
 * patient UPDATE policy at all, so this always goes through
 * public.complete_care_task(), which validates ownership and restricts which
 * transitions a patient may make. See the care_tasks migration for why.
 */
export function useCompleteCareTask(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      status,
      evidence,
      unableReason,
    }: {
      taskId: string;
      status: "in_progress" | "completed" | "unable_to_complete";
      evidence?: Json;
      unableReason?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("complete_care_task", {
        p_task_id: taskId,
        p_status: status,
        p_evidence: evidence ?? undefined,
        p_unable_reason: unableReason ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: careTaskKeys.patient(patientId) });
    },
  });
}

/** Clinician/care coordinator adds an ad-hoc task outside a programme template. */
export function useCreateCareTask(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      carePlanId?: string | null;
      goalId?: string | null;
      title: string;
      description?: string;
      ownerRole?: CareTaskOwnerRole;
      ownerId?: string | null;
      priority?: number;
      dueAt?: string | null;
      recurrence?: "daily" | "weekly" | "monthly" | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("care_tasks").insert({
        organisation_id: input.organisationId,
        patient_id: patientId,
        care_plan_id: input.carePlanId ?? null,
        goal_id: input.goalId ?? null,
        title: input.title,
        description: input.description ?? null,
        owner_role: input.ownerRole ?? "patient",
        owner_id: input.ownerId ?? null,
        priority: input.priority ?? 2,
        due_at: input.dueAt ?? null,
        recurrence: input.recurrence ?? null,
        source: "clinician",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: careTaskKeys.patient(patientId) });
    },
  });
}

/** Clinician/care coordinator cancels a task that's no longer clinically relevant. */
export function useCancelCareTask(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("care_tasks")
        .update({ status: "cancelled" })
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: careTaskKeys.patient(patientId) });
    },
  });
}
