import { useQuery } from "@tanstack/react-query";
import { getProposedConfig } from "@tarragon/shared";
import { assessReadiness, type ReadinessBandsConfig, type ReadinessResult, type WearableReadingPoint } from "@tarragon/clinical/activity-readiness";
import { createClient } from "@/lib/supabase/client";

/**
 * Training load, recovery and sleep bands from the person's own stored device readings (S48b, spec 5.6). The bands are computed by the pure
 * function in packages/clinical (deterministic, no language model). Resolves to null (show nothing) when there is no device data, too little to
 * compare, or the read fails: dormant until a provider is connected. Always an estimate, compared only with the person's own usual.
 */
export async function fetchReadiness(patientId: string, nowMs: number): Promise<ReadinessResult | null> {
  const since = new Date(nowMs - 36 * 86_400_000).toISOString();
  const db = createClient();
  // Only this person's own devices: wearable_readings has no patient column, and staff or a caregiver can read more rows than the person shown.
  const conns = await db.from("wearable_connections").select("id").eq("patient_id", patientId);
  const ids = (conns.data ?? []).map((c) => c.id);
  if (conns.error || ids.length === 0) return null;
  const { data, error } = await db
    .from("wearable_readings")
    .select("reading_type, value, recorded_at")
    .in("connection_id", ids)
    .in("reading_type", ["recovery_score", "hrv_ms", "sleep_minutes", "strain", "steps"])
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: false })
    .limit(3000);
  if (error || !data) return null;
  const points: WearableReadingPoint[] = data.flatMap((r) =>
    r.value === null ? [] : [{ readingType: r.reading_type, value: Number(r.value), recordedAt: r.recorded_at }],
  );
  const cfg = getProposedConfig("activity.readiness_bands").value as unknown as ReadinessBandsConfig;
  const result = assessReadiness(points, new Date(nowMs), cfg);
  return result.state === "no_data" ? null : result;
}

export function useReadiness(patientId: string) {
  return useQuery({
    queryKey: ["activity-readiness", patientId],
    queryFn: () => fetchReadiness(patientId, Date.now()),
    enabled: !!patientId,
  });
}
