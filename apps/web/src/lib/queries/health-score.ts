import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function useLatestHealthScore(patientId: string) {
  return useQuery({
    queryKey: ["health-score", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_risk_scores")
        .select("score, risk_level, inputs, computed_at")
        .eq("patient_id", patientId)
        .eq("score_type", "health_score")
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}
