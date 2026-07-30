import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface ImpactMetricRow {
  metric_key: string;
  label: string;
  description: string | null;
  value: number | null;
  suppressed: boolean;
  is_published: boolean;
  computed_at: string | null;
  display_order: number;
}

/** Admin view of every public_impact_metrics row, published or not — RLS (impact_metrics.manage) is the real gate. */
export function useImpactMetrics() {
  return useQuery({
    queryKey: ["impact-metrics", "admin", "all"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("public_impact_metrics")
        .select("*")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data as ImpactMetricRow[];
    },
  });
}

/** Toggles whether a metric is shown on the public /impact page. */
export function useSetImpactMetricPublished() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ metricKey, isPublished }: { metricKey: string; isPublished: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("admin_set_impact_metric_published", {
        p_metric_key: metricKey,
        p_is_published: isPublished,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["impact-metrics"] });
    },
  });
}

/** Runs the same aggregate refresh the nightly cron runs, on demand. */
export function useRecomputeImpactMetrics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("admin_refresh_public_impact_metrics");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["impact-metrics"] });
    },
  });
}
