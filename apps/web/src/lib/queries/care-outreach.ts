import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables, Enums } from "@tarragon/shared";

export type OutreachTask = Tables<"care_outreach_tasks">;
export type OutreachStatus = Enums<"outreach_task_status">;

export type OutreachTaskWithPatient = OutreachTask & {
  patient: { full_name: string | null; patient_number: string | null; phone: string | null } | null;
};

const TASK_SELECT =
  "*, patient:profiles!care_outreach_tasks_patient_id_fkey(full_name, patient_number, phone)";

export const outreachKeys = {
  org: ["care-outreach", "org"] as const,
};

/**
 * The proactive-outreach worklist — every live task the nightly
 * private.queue_care_outreach() engine surfaced from risk scores + care gaps.
 * RLS (private.is_org_staff) scopes to the org; patients never see this table.
 */
export function useOutreachTasks() {
  return useQuery({
    queryKey: outreachKeys.org,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_outreach_tasks")
        .select(TASK_SELECT)
        .in("status", ["open", "in_progress", "contacted"])
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as OutreachTaskWithPatient[];
    },
  });
}

/**
 * Move a task through its logistics states. resolved_by/resolved_at are
 * stamped server-side by private.stamp_outreach_resolution — never sent from
 * here (client values are overwritten by the trigger anyway).
 */
export function useUpdateOutreachTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      status,
      outcomeNote,
      claim,
    }: {
      taskId: string;
      status?: OutreachStatus;
      outcomeNote?: string | null;
      claim?: boolean;
    }) => {
      const supabase = createClient();
      const update: {
        status?: OutreachStatus;
        outcome_note?: string | null;
        assigned_to?: string;
      } = {};
      if (status) update.status = status;
      if (outcomeNote !== undefined) update.outcome_note = outcomeNote;
      if (claim) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) update.assigned_to = user.id;
      }
      const { error } = await supabase
        .from("care_outreach_tasks")
        .update(update)
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: outreachKeys.org });
    },
  });
}
