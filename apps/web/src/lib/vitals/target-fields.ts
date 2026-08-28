import type { Database } from "@tarragon/shared";

type VitalType = Database["public"]["Enums"]["vital_type"];

/** The single (or, for BP, pair of) numeric field(s) a target/baseline value
 * needs per vital_type — same key names private.set_monitoring_baseline_on_
 * first_reading() uses when it builds a baseline jsonb, so a schedule
 * item's target/acceptable_range/baseline_value all share one shape per
 * vital_type. Vitals with no clinically meaningful single-value target
 * (ketones, waist_circumference) are omitted — their monitoring is
 * frequency/adherence-only. */
export const TARGET_FIELDS: Partial<Record<VitalType, { key: string; label: string; unit: string }[]>> = {
  blood_pressure: [
    { key: "systolic", label: "Systolic", unit: "mmHg" },
    { key: "diastolic", label: "Diastolic", unit: "mmHg" },
  ],
  glucose: [{ key: "glucose_mmol_l", label: "Glucose", unit: "mmol/L" }],
  weight: [{ key: "weight_kg", label: "Weight", unit: "kg" }],
  pulse: [{ key: "pulse_bpm", label: "Pulse", unit: "bpm" }],
  temperature: [{ key: "temperature_c", label: "Temperature", unit: "°C" }],
  spo2: [{ key: "spo2_pct", label: "SpO2", unit: "%" }],
};

export const VITAL_TYPE_LABEL: Record<VitalType, string> = {
  blood_pressure: "Blood pressure",
  glucose: "Blood glucose",
  weight: "Weight",
  pulse: "Pulse",
  temperature: "Temperature",
  spo2: "Oxygen saturation",
  waist_circumference: "Waist circumference",
  ketones: "Ketones",
  respiratory_rate: "Respiratory rate",
  peak_flow: "Peak flow",
};
