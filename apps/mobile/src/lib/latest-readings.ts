import {
  formatGlucose,
  GLUCOSE_UNIT_LABEL,
  homePinVitalDisplay,
  readingDetail,
  type GlucoseDisplayUnit,
  type MeasurementUnits,
  type PinSeries,
  type SparkPoint,
} from "@tarragon/shared";

/** The readings in the Vitals row under the blood pressure card, as on the web (latest-readings-row.tsx). */
export const LATEST_ROW_KEYS = ["glucose", "weight", "pulse"] as const;
export type LatestRowKey = (typeof LATEST_ROW_KEYS)[number];

export const LATEST_ROW_LABEL: Record<LatestRowKey, string> = { glucose: "Blood sugar", weight: "Weight", pulse: "Pulse" };

export interface LatestReadingContent {
  label: string;
  value?: string;
  unit?: string;
  empty?: string;
  detail?: string | null;
  points?: SparkPoint[];
}

/**
 * One tile in the Vitals latest-readings row: the latest value in the reader's own unit, when, the trend word and the 30-day line.
 * A failed read says "Couldn't load just now", never "No reading yet"; `undefined` (still loading) shows no value yet either.
 */
export function latestReadingContent(
  key: LatestRowKey,
  series: PinSeries | "failed" | undefined,
  glucoseUnit: GlucoseDisplayUnit,
  units: MeasurementUnits,
  nowMs: number,
): LatestReadingContent {
  const label = LATEST_ROW_LABEL[key];
  if (series === "failed") return { label, empty: "Couldn't load just now" };
  if (series === undefined) return { label, empty: "Loading" };
  const shown =
    series.latestValue === null
      ? null
      : key === "glucose"
        ? { value: formatGlucose(series.latestValue, glucoseUnit, { withUnit: false }) ?? "", unit: GLUCOSE_UNIT_LABEL[glucoseUnit] }
        : homePinVitalDisplay(key, series.latestValue, units);
  return {
    label,
    ...(shown?.value ? { value: shown.value, unit: shown.unit } : { empty: "No reading yet" }),
    detail: readingDetail(series, nowMs),
    points: series.points,
  };
}
