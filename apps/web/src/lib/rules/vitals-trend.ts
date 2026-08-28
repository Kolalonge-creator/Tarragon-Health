/**
 * Applies lib/rules/longitudinal.ts's trend engine — direction, variability,
 * persistence (consecutiveCount) and rate of change (§6.9) — to home-
 * monitored vitals. Until now that engine only ever saw lab_analyte_readings
 * (via lib/clinical/patient-clinical-context.ts); BP/glucose/weight/pulse/
 * temperature/spo2 readings had no equivalent, just a per-reading red/green
 * classification (bp-classification.ts and friends) with no memory of the
 * series. This is the same engine, not a second one — see analyseSeries's
 * `config` option, added for exactly this.
 */

import { analyseSeries, type SeriesConfig, type TrendFinding } from "@/lib/rules/longitudinal";
import type { Tables } from "@tarragon/shared";

export type VitalsTrendMetric =
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic"
  | "glucose"
  | "weight"
  | "pulse"
  | "temperature"
  | "spo2";

/** Higher value = clinically worse direction, for every metric this adapter
 * covers. spo2 is the one exception on this platform — lower is worse. */
export const VITALS_TREND_HIGHER_IS_WORSE: Record<VitalsTrendMetric, boolean> = {
  blood_pressure_systolic: true,
  blood_pressure_diastolic: true,
  glucose: true,
  weight: true,
  pulse: true,
  temperature: true,
  spo2: false,
};

const VITALS_SERIES_CONFIG: Record<VitalsTrendMetric, Omit<SeriesConfig, "range">> = {
  blood_pressure_systolic: { label: "Systolic blood pressure", unit: "mmHg", meaningfulChangePct: 8 },
  blood_pressure_diastolic: { label: "Diastolic blood pressure", unit: "mmHg", meaningfulChangePct: 8 },
  glucose: { label: "Blood glucose", unit: "mmol/L", meaningfulChangePct: 15 },
  weight: { label: "Weight", unit: "kg", meaningfulChangePct: 3 },
  pulse: { label: "Pulse", unit: "bpm", meaningfulChangePct: 10 },
  temperature: { label: "Temperature", unit: "°C", meaningfulChangePct: 2 },
  spo2: { label: "Oxygen saturation", unit: "%", meaningfulChangePct: 3 },
};

type VitalsReadingRow = Pick<
  Tables<"vitals_readings">,
  | "vital_type"
  | "taken_at"
  | "systolic"
  | "diastolic"
  | "glucose_mmol_l"
  | "weight_kg"
  | "pulse_bpm"
  | "temperature_c"
  | "spo2_pct"
>;

function metricValue(reading: VitalsReadingRow, metric: VitalsTrendMetric): number | null {
  switch (metric) {
    case "blood_pressure_systolic":
      return reading.vital_type === "blood_pressure" ? reading.systolic : null;
    case "blood_pressure_diastolic":
      return reading.vital_type === "blood_pressure" ? reading.diastolic : null;
    case "glucose":
      return reading.vital_type === "glucose" ? reading.glucose_mmol_l : null;
    case "weight":
      return reading.vital_type === "weight" ? reading.weight_kg : null;
    case "pulse":
      return reading.vital_type === "pulse" ? reading.pulse_bpm : null;
    case "temperature":
      return reading.vital_type === "temperature" ? reading.temperature_c : null;
    case "spo2":
      return reading.vital_type === "spo2" ? reading.spo2_pct : null;
  }
}

/**
 * `range`, when supplied, should come from the PATIENT'S OWN
 * monitoring_schedule_items.acceptable_range (§6.10 — "never assume one
 * universal target"), never a hardcoded population band. Omit it and the
 * engine still reports direction/variability/persistence/rate of change —
 * only the "outside_range" significance tier needs a range to mean anything.
 */
export function analyseVitalsTrend(
  readings: VitalsReadingRow[],
  metric: VitalsTrendMetric,
  range?: { low: number; high: number } | null,
): TrendFinding | null {
  const points = readings
    .map((r) => ({ value: metricValue(r, metric), takenAt: r.taken_at }))
    .filter((p): p is { value: number; takenAt: string } => p.value !== null);

  return analyseSeries(metric, points, { config: { ...VITALS_SERIES_CONFIG[metric], range: range ?? null } });
}
