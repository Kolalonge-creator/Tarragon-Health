import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums, Tables } from "@tarragon/shared";

export type LifestyleBarrierReport = Tables<"lifestyle_barrier_reports">;

export function useLifestyleBarrierReports(
  patientId: string,
  domain?: Enums<"lifestyle_domain">,
  limit = 10,
) {
  return useQuery({
    queryKey: ["lifestyle-barrier-reports", patientId, domain, limit],
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("lifestyle_barrier_reports")
        .select("*")
        .eq("patient_id", patientId)
        .order("reported_at", { ascending: false })
        .limit(limit);
      if (domain) query = query.eq("domain", domain);
      const { data, error } = await query;
      if (error) throw error;
      return data as LifestyleBarrierReport[];
    },
    enabled: !!patientId,
  });
}
