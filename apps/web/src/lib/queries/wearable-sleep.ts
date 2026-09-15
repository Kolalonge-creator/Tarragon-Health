import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * 53.8 "Sleep tracking": duration, consistency, trend — computed client-side
 * from wearable_readings' sleep_minutes samples. There's no patient_id
 * column on wearable_readings to filter by (RLS scopes it via the owning
 * connection's patient_id = auth.uid() instead — see its own migration), so
 * this is a session-scoped read, same as wearable-connect-card.tsx's
 * connection list; `patientId` only keys the query cache.
 */

const NIGHTS_WINDOW = 14;

export interface SleepSummary {
  /** Most recent night's duration, in minutes. Null if nothing has synced. */
  lastNightMinutes: number | null;
  /** Average duration over the nights actually present in the window
   * (up to NIGHTS_WINDOW), not a fixed 7 — a newly connected wearable with
   * three nights of history shouldn't average against four missing ones. */
  averageMinutes: number | null;
  nightsInWindow: number;
  consistency: "consistent" | "somewhat_variable" | "irregular" | "unknown";
  trend: "up" | "down" | "flat" | "unknown";
}

/** Exported for direct unit testing — the query hook below is a thin
 * Supabase wrapper around this, which is where the actual logic lives. */
export function summarise(values: number[]): SleepSummary {
  if (values.length === 0) {
    return {
      lastNightMinutes: null,
      averageMinutes: null,
      nightsInWindow: 0,
      consistency: "unknown",
      trend: "unknown",
    };
  }

  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length;
  const stdDevMinutes = Math.sqrt(variance);

  let consistency: SleepSummary["consistency"] = "consistent";
  if (values.length >= 3) {
    if (stdDevMinutes > 90) consistency = "irregular";
    else if (stdDevMinutes > 45) consistency = "somewhat_variable";
  } else {
    consistency = "unknown"; // Too few nights to say anything meaningful.
  }

  let trend: SleepSummary["trend"] = "unknown";
  if (values.length >= 4) {
    const half = Math.floor(values.length / 2);
    // values[0] is the most recent night (query orders desc).
    const recentAvg = values.slice(0, half).reduce((sum, v) => sum + v, 0) / half;
    const priorAvg = values.slice(half).reduce((sum, v) => sum + v, 0) / (values.length - half);
    const deltaMinutes = recentAvg - priorAvg;
    trend = deltaMinutes > 20 ? "up" : deltaMinutes < -20 ? "down" : "flat";
  }

  return {
    lastNightMinutes: Math.round(values[0]),
    averageMinutes: Math.round(average),
    nightsInWindow: values.length,
    consistency,
    trend,
  };
}

export function useSleepSummary(patientId: string) {
  return useQuery({
    queryKey: ["wearable-sleep-summary", patientId],
    queryFn: async (): Promise<SleepSummary> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("wearable_readings")
        .select("value, recorded_at")
        .eq("reading_type", "sleep_minutes")
        .order("recorded_at", { ascending: false })
        .limit(NIGHTS_WINDOW);
      if (error) throw error;
      const values = (data ?? [])
        .map((row) => row.value)
        .filter((v): v is number => v !== null);
      return summarise(values);
    },
    enabled: !!patientId,
  });
}
