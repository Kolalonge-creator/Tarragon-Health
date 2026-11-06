import { createClient } from "@/lib/supabase/server";
import {
  HOME_PIN_NEVER_FROM_WEARABLE,
  HOME_PIN_VITAL_COLUMN,
  HOME_PIN_VITAL_TYPE,
  isHomeValuePin,
  type HomePinKey,
} from "@tarragon/shared";
import type { SparkPoint } from "@/components/charts/sparkline";

/** The readings a pinned tile can chart. */
export type SeriesPinKey = "bp" | "glucose" | keyof typeof HOME_PIN_VITAL_COLUMN;

export interface PinSeries {
  /** When the most recent reading was taken (it may be older than the chart window), or null with no reading. */
  latestAt: number | null;
  /** The most recent reading's stored value (kg, mmol/L, bpm...), never converted; for blood pressure, the top number. */
  latestValue: number | null;
  /** Readings in the last 30 days, oldest first. For blood pressure, the top (systolic) number. */
  points: SparkPoint[];
}

const WINDOW_DAYS = 30;
/** Enough rows to cover a month of several readings a day without reading the whole history. */
const MAX_ROWS = 120;

function seriesColumn(key: SeriesPinKey): string {
  if (key === "bp") return "systolic";
  if (key === "glucose") return "glucose_mmol_l";
  return HOME_PIN_VITAL_COLUMN[key];
}

function vitalType(key: SeriesPinKey) {
  return HOME_PIN_VITAL_TYPE[key];
}

/** Blood pressure joins the never-from-a-wearable rule here, as on the summary stats: a cuffless estimate is not a reading. */
function excludesWearable(key: SeriesPinKey): boolean {
  return key === "bp" || HOME_PIN_NEVER_FROM_WEARABLE.includes(key as HomePinKey);
}

export function isSeriesPin(key: HomePinKey): key is SeriesPinKey {
  return key === "bp" || key === "glucose" || isHomeValuePin(key);
}

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
  const since = nowMs - WINDOW_DAYS * 86_400_000;

  const entries = await Promise.all(
    wanted.map(async (key) => {
      const column = seriesColumn(key);
      let query = supabase
        .from("vitals_readings")
        .select(`taken_at, ${column}`)
        .eq("patient_id", patientId)
        .eq("vital_type", vitalType(key))
        .is("correction_status", null)
        .not(column, "is", null);
      if (excludesWearable(key)) query = query.neq("source", "wearable");
      const { data, error } = await query.order("taken_at", { ascending: false }).limit(MAX_ROWS);
      if (error) return [key, "failed"] as const;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      const parsed = rows
        .map((row) => ({ t: Date.parse(String(row.taken_at)), v: Number(row[column]) }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v));
      const series: PinSeries = {
        latestAt: parsed[0]?.t ?? null,
        latestValue: parsed[0]?.v ?? null,
        points: parsed.filter((p) => p.t >= since).reverse(),
      };
      return [key, series] as const;
    }),
  );
  return Object.fromEntries(entries) as Partial<Record<SeriesPinKey, PinSeries | "failed">>;
}
