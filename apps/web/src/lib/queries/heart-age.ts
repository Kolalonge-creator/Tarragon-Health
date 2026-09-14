import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { HeartAgeResponse } from "@tarragon/shared";

/** Mirrors health-score.ts's useLatestHealthScore, reading score_type
 * 'heart_age' instead. `inputs` holds the full HeartAgeResponse the ML
 * service returned (see screening-result-actions.ts's maybeComputeCvdRisk),
 * so the card can show the underlying cvd_risk_10yr_percent alongside the
 * age itself without a second query. */
export function useLatestHeartAge(patientId: string) {
  return useQuery({
    queryKey: ["heart-age", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_risk_scores")
        .select("score, risk_level, inputs, computed_at")
        .eq("patient_id", patientId)
        .eq("score_type", "heart_age")
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as
        | { score: number | null; risk_level: string | null; inputs: HeartAgeResponse | null; computed_at: string }
        | null;
    },
    enabled: !!patientId,
  });
}

/** Ascending Heart Age history, oldest first — every row a real write from
 * screening-result-actions.ts's Heart Age computation (lipid-panel-driven,
 * so naturally sparse), never synthesised or interpolated. Mirrors
 * health-score.ts's useHealthScoreHistory. */
export function useHeartAgeHistory(patientId: string) {
  return useQuery({
    queryKey: ["heart-age-history", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_risk_scores")
        .select("score, computed_at")
        .eq("patient_id", patientId)
        .eq("score_type", "heart_age")
        .order("computed_at", { ascending: true })
        .limit(60);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}
