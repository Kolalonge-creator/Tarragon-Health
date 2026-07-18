import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ScreeningSchedule = Tables<"screening_schedules"> & {
  screen_type: { name: string; code: string } | null;
};

export function useScreeningSchedules(patientId: string) {
  return useQuery({
    queryKey: ["screening-schedules", patientId],
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
