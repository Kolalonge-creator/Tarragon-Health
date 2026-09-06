import { marketingAnonClient as anonClient } from "./anon-client";

/**
 * Public "impact" dashboard data (M8: public outcomes dashboard). Reads
 * published public_impact_metrics rows through a BARE anon supabase-js
 * client — same deliberate pattern as resources-data.ts, so the marketing
 * tree stays free of auth/platform module imports. Unlike the resources
 * library, there is no static fallback: a live count that can't be fetched
 * should show nothing rather than a fabricated number.
 */

export interface ImpactMetric {
  metricKey: string;
  label: string;
  description: string | null;
  value: number | null;
  suppressed: boolean;
  computedAt: string | null;
}

export async function loadImpactMetrics(): Promise<ImpactMetric[]> {
  const client = anonClient();
  if (!client) return [];
  const { data, error } = await client
    .from("public_impact_metrics")
    .select("metric_key, label, description, value, suppressed, computed_at, display_order")
    .eq("is_published", true)
    .order("display_order", { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    metricKey: row.metric_key,
    label: row.label,
    description: row.description,
    value: row.value,
    suppressed: row.suppressed,
    computedAt: row.computed_at,
  }));
}
