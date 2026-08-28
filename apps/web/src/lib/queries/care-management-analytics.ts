import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type CareManagementKpis = {
  programme_enrolments: {
    programme: string;
    condition: string;
    enrolled: number;
    completed: number;
    withdrawn: number;
  }[];
  tasks_completion_rate_30d: number | null;
  tasks_overdue_now: number;
  tasks_high_priority_overdue: number;
  care_task_escalations_30d: number;
  goals_achieved_30d: number;
  goals_active: number;
};

/**
 * Care Management Engine analytics (§3.20) — programme enrolment, task
 * completion, dropout, and escalation counts for the calling org. The RPC
 * itself enforces private.is_org_staff(p_org), same pattern as
 * useHtnQualityMetrics, so this is safe to call from any admin/staff surface.
 */
export function useCareManagementKpis(organisationId: string | null | undefined) {
  return useQuery({
    queryKey: ["care-management-kpis", organisationId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("care_management_kpis", {
        p_org: organisationId as string,
      });
      if (error) throw error;
      return data as unknown as CareManagementKpis;
    },
    enabled: !!organisationId,
  });
}
