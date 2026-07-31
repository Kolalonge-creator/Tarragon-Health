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

/**
 * Ascending Health Score history, oldest first — powers the "since you
 * started" trend narrative. Every score is a real write from
 * assessHealthScoreBestEffort; nothing here is synthesised or interpolated.
 */
export function useHealthScoreHistory(patientId: string) {
  return useQuery({
    queryKey: ["health-score-history", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_risk_scores")
        .select("score, inputs, computed_at")
        .eq("patient_id", patientId)
        .eq("score_type", "health_score")
        .order("computed_at", { ascending: true })
        .limit(60);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}
