import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type RiskAssessmentResponse = Tables<"risk_assessment_responses">;
export type PreventionRiskScore = Tables<"prevention_risk_scores">;

/** Full response history is kept (no upsert) — dedupe to latest per question. */
export function useRiskAssessmentResponses(patientId: string) {
  return useQuery({
    queryKey: ["risk-assessment-responses", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("risk_assessment_responses")
        .select("*")
        .eq("profile_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const latestByKey = new Map<string, RiskAssessmentResponse>();
      for (const row of data as RiskAssessmentResponse[]) {
        if (!latestByKey.has(row.question_key)) {
          latestByKey.set(row.question_key, row);
        }
      }
      return [...latestByKey.values()];
    },
    enabled: !!patientId,
  });
}

/** Each submission inserts a new snapshot — dedupe to latest per condition. */
export function useRiskScores(patientId: string) {
  return useQuery({
    queryKey: ["prevention-risk-scores", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("prevention_risk_scores")
        .select("*")
        .eq("profile_id", patientId)
        .order("computed_at", { ascending: false });
      if (error) throw error;

      const latestByCondition = new Map<string, PreventionRiskScore>();
      for (const row of data as PreventionRiskScore[]) {
        if (!latestByCondition.has(row.condition)) {
          latestByCondition.set(row.condition, row);
        }
      }
      return [...latestByCondition.values()];
    },
    enabled: !!patientId,
  });
}
