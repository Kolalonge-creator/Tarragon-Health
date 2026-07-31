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

/** Every chronic-disease risk-score type besides health_score (which has
 * its own dedicated HealthScoreCard/useLatestHealthScore) — latest row per
 * score_type, for RiskSignalsCard's plain-language "what your care team is
 * watching" surface. Never exposes a raw score/number to the patient. */
export function usePatientRiskSignals(patientId: string) {
  return useQuery({
    queryKey: ["patient-risk-signals", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_risk_scores")
        .select("score_type, risk_level, computed_at")
        .eq("patient_id", patientId)
        .neq("score_type", "health_score")
        .order("computed_at", { ascending: false });
      if (error) throw error;

      const latestByType = new Map<string, (typeof data)[number]>();
      for (const row of data) {
        if (!latestByType.has(row.score_type)) latestByType.set(row.score_type, row);
      }
      return [...latestByType.values()];
    },
    enabled: !!patientId,
  });
}
