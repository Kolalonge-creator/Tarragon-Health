import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type CarePlan = Tables<"care_plans"> & {
  assigned_clinician: { full_name: string | null } | null;
};

export function useCarePlans(patientId: string) {
  return useQuery({
    queryKey: ["care-plans", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_plans")
        .select(
          "*, assigned_clinician:profiles!care_plans_assigned_clinician_id_fkey(full_name)"
        )
        .eq("patient_id", patientId)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CarePlan[];
    },
    enabled: !!patientId,
  });
}
