import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/** Shape returned by public.hbpm_summary (TH-CP-HTN-001 §5.3 / §12.2). */
export interface HbpmSummary {
  target: { systolic: number; diastolic: number; source: string };
  average: {
    systolic: number;
    diastolic: number;
    n_readings: number;
    n_days: number;
    window_start: string;
    meets_home_htn: boolean;
    at_target: boolean;
  } | null;
}

export function useHbpmSummary(patientId: string) {
  return useQuery({
    queryKey: ["hbpm-summary", patientId],
    queryFn: async (): Promise<HbpmSummary> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("hbpm_summary", { p_patient: patientId });
      if (error) throw error;
      return data as unknown as HbpmSummary;
    },
    enabled: !!patientId,
  });
}
