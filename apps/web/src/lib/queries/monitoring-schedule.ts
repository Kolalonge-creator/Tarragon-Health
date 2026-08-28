import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database, Json } from "@tarragon/shared";

type MonitoringScheduleItem = Database["public"]["Tables"]["monitoring_schedule_items"]["Row"];

/** A patient's active monitoring_schedule_items rows (§6.3/§6.4) — auto-
 * seeded on chronic programme enrolment, editable here per-patient. */
export function useMonitoringSchedule(patientId: string) {
  return useQuery({
    queryKey: ["monitoring-schedule", patientId],
    queryFn: async (): Promise<MonitoringScheduleItem[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("monitoring_schedule_items")
        .select("*")
        .eq("patient_id", patientId)
        .in("status", ["active", "paused"])
        .order("vital_type");
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export interface UpdateMonitoringScheduleItemInput {
  id: string;
  patientId: string;
  frequency_per_week: number;
  status: Database["public"]["Enums"]["monitoring_item_status"];
  patient_instructions: string | null;
  target: Json | null;
}

/** Direct table UPDATE, not a dedicated RPC — org staff already have RLS
 * write access to monitoring_schedule_items (see its migration), the same
 * pattern useAssignCareTeam() already uses for care_team_assignment. */
export function useUpdateMonitoringScheduleItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMonitoringScheduleItemInput) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("monitoring_schedule_items")
        .update({
          frequency_per_week: input.frequency_per_week,
          status: input.status,
          patient_instructions: input.patient_instructions,
          target: input.target,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["monitoring-schedule", variables.patientId] });
      queryClient.invalidateQueries({ queryKey: ["vitals-adherence", variables.patientId] });
    },
  });
}
