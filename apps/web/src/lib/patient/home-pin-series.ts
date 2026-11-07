import { createClient } from "@/lib/supabase/server";
import {
  PIN_SERIES_MAX_ROWS,
  isSeriesPin,
  parsePinSeries,
  pinSeriesColumn,
  pinSeriesExcludesWearable,
  pinSeriesVitalType,
  type HomePinKey,
  type PinSeries,
  type SeriesPinKey,
} from "@tarragon/shared";

// The reading rules and the row parsing live in @tarragon/shared (reading-trends.ts), shared with the phone app.
export { isSeriesPin, type PinSeries, type SeriesPinKey };

/**
 * The last month of readings behind each pinned vitals tile (2026-11-06: big numbers with a 30-day trend line). Same rules
 * as "the latest reading": a superseded or entered-in-error reading never counts, and a wearable estimate never counts for
 * blood pressure, pulse, oxygen or temperature. A pin whose read failed is "failed", so its tile can say it could not load
 * rather than drawing an empty chart.
 */
export async function getPinSeries(
  patientId: string,
  pins: readonly HomePinKey[],
  nowMs: number = Date.now(),
): Promise<Partial<Record<SeriesPinKey, PinSeries | "failed">>> {
  const wanted = pins.filter(isSeriesPin);
  if (wanted.length === 0) return {};
  const supabase = await createClient();

  const entries = await Promise.all(
    wanted.map(async (key) => {
      const column = pinSeriesColumn(key);
      let query = supabase
        .from("vitals_readings")
        .select(`taken_at, ${column}`)
        .eq("patient_id", patientId)
        .eq("vital_type", pinSeriesVitalType(key))
        .is("correction_status", null)
        .not(column, "is", null);
      if (pinSeriesExcludesWearable(key)) query = query.neq("source", "wearable");
      const { data, error } = await query.order("taken_at", { ascending: false }).limit(PIN_SERIES_MAX_ROWS);
      if (error) return [key, "failed"] as const;
      return [key, parsePinSeries((data ?? []) as unknown as Record<string, unknown>[], column, nowMs)] as const;
    }),
  );
  return Object.fromEntries(entries) as Partial<Record<SeriesPinKey, PinSeries | "failed">>;
}
