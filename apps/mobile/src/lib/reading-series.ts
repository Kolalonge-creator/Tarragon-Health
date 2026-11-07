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
import { supabase } from "./supabase";

export type PinSeriesMap = Partial<Record<SeriesPinKey, PinSeries | "failed">>;

/**
 * The last month of readings behind each big-number tile on the phone (Home pins and the Vitals row), the same rules as the web
 * (@tarragon/shared reading-trends.ts): a superseded or entered-in-error reading never counts, and a wearable estimate never
 * counts for blood pressure, pulse, oxygen or temperature. RLS keeps the read to records this account may see. A key whose read
 * failed is "failed", so its tile says it could not load rather than drawing an empty chart.
 */
export async function loadPinSeries(patientId: string, keys: readonly HomePinKey[], nowMs: number = Date.now()): Promise<PinSeriesMap> {
  const wanted = keys.filter(isSeriesPin);
  if (wanted.length === 0) return {};
  const entries = await Promise.all(
    wanted.map(async (key): Promise<readonly [SeriesPinKey, PinSeries | "failed"]> => {
      const column = pinSeriesColumn(key);
      try {
        let query = supabase
          .from("vitals_readings")
          .select(`taken_at, ${column}`)
          .eq("patient_id", patientId)
          .eq("vital_type", pinSeriesVitalType(key))
          .is("correction_status", null)
          .not(column, "is", null);
        if (pinSeriesExcludesWearable(key)) query = query.neq("source", "wearable");
        const { data, error } = await query.order("taken_at", { ascending: false }).limit(PIN_SERIES_MAX_ROWS);
        if (error) return [key, "failed"];
        return [key, parsePinSeries((data ?? []) as unknown as Record<string, unknown>[], column, nowMs)];
      } catch {
        return [key, "failed"];
      }
    }),
  );
  return Object.fromEntries(entries) as PinSeriesMap;
}
