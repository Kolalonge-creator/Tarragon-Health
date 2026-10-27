/**
 * Display units for weight, temperature and body measurements (waist, height).
 *
 * Same rule as the glucose unit (GLUCOSE_DISPLAY_UNITS in index.ts): what is STORED never changes
 * (vitals_readings keeps kg, degrees Celsius and cm), so switching the setting only changes how a
 * figure is shown and which unit a new entry is typed in. Nothing clinical (thresholds, red flags,
 * risk scores) reads these. The database CHECKs on profiles mirror these lists.
 */

export const WEIGHT_DISPLAY_UNITS = ["kg", "lb"] as const;
export type WeightDisplayUnit = (typeof WEIGHT_DISPLAY_UNITS)[number];
export const DEFAULT_WEIGHT_DISPLAY_UNIT: WeightDisplayUnit = "kg";

export const TEMPERATURE_DISPLAY_UNITS = ["c", "f"] as const;
export type TemperatureDisplayUnit = (typeof TEMPERATURE_DISPLAY_UNITS)[number];
export const DEFAULT_TEMPERATURE_DISPLAY_UNIT: TemperatureDisplayUnit = "c";

export const LENGTH_DISPLAY_UNITS = ["cm", "in"] as const;
export type LengthDisplayUnit = (typeof LENGTH_DISPLAY_UNITS)[number];
export const DEFAULT_LENGTH_DISPLAY_UNIT: LengthDisplayUnit = "cm";

export const WEIGHT_UNIT_LABEL: Record<WeightDisplayUnit, string> = { kg: "kg", lb: "lb" };
export const TEMPERATURE_UNIT_LABEL: Record<TemperatureDisplayUnit, string> = { c: "°C", f: "°F" };
export const LENGTH_UNIT_LABEL: Record<LengthDisplayUnit, string> = { cm: "cm", in: "in" };

const LB_PER_KG = 2.2046226218;
const CM_PER_IN = 2.54;

export function isWeightDisplayUnit(v: unknown): v is WeightDisplayUnit {
  return typeof v === "string" && (WEIGHT_DISPLAY_UNITS as readonly string[]).includes(v);
}
export function isTemperatureDisplayUnit(v: unknown): v is TemperatureDisplayUnit {
  return typeof v === "string" && (TEMPERATURE_DISPLAY_UNITS as readonly string[]).includes(v);
}
export function isLengthDisplayUnit(v: unknown): v is LengthDisplayUnit {
  return typeof v === "string" && (LENGTH_DISPLAY_UNITS as readonly string[]).includes(v);
}

/** A stored profile value as a valid unit, falling back to the default for anything unexpected. */
export function weightUnitOrDefault(v: unknown): WeightDisplayUnit {
  return isWeightDisplayUnit(v) ? v : DEFAULT_WEIGHT_DISPLAY_UNIT;
}
export function temperatureUnitOrDefault(v: unknown): TemperatureDisplayUnit {
  return isTemperatureDisplayUnit(v) ? v : DEFAULT_TEMPERATURE_DISPLAY_UNIT;
}
export function lengthUnitOrDefault(v: unknown): LengthDisplayUnit {
  return isLengthDisplayUnit(v) ? v : DEFAULT_LENGTH_DISPLAY_UNIT;
}

export interface MeasurementUnits {
  weight: WeightDisplayUnit;
  temperature: TemperatureDisplayUnit;
  length: LengthDisplayUnit;
}

export const DEFAULT_MEASUREMENT_UNITS: MeasurementUnits = {
  weight: DEFAULT_WEIGHT_DISPLAY_UNIT,
  temperature: DEFAULT_TEMPERATURE_DISPLAY_UNIT,
  length: DEFAULT_LENGTH_DISPLAY_UNIT,
};

/** Reads the three columns off a profile row (or anything shaped like one). */
export function measurementUnitsFromProfile(
  p: { weight_display_unit?: unknown; temperature_display_unit?: unknown; length_display_unit?: unknown } | null | undefined,
): MeasurementUnits {
  return {
    weight: weightUnitOrDefault(p?.weight_display_unit),
    temperature: temperatureUnitOrDefault(p?.temperature_display_unit),
    length: lengthUnitOrDefault(p?.length_display_unit),
  };
}

// Stored value (kg / C / cm) -> the number in the patient's unit.
export function weightFromKg(kg: number, unit: WeightDisplayUnit): number {
  return unit === "lb" ? kg * LB_PER_KG : kg;
}
export function temperatureFromC(c: number, unit: TemperatureDisplayUnit): number {
  return unit === "f" ? (c * 9) / 5 + 32 : c;
}
export function lengthFromCm(cm: number, unit: LengthDisplayUnit): number {
  return unit === "in" ? cm / CM_PER_IN : cm;
}

// The number typed in the patient's unit -> the stored value.
export function weightToKg(value: number, unit: WeightDisplayUnit): number {
  return unit === "lb" ? value / LB_PER_KG : value;
}
export function temperatureToC(value: number, unit: TemperatureDisplayUnit): number {
  return unit === "f" ? ((value - 32) * 5) / 9 : value;
}
export function lengthToCm(value: number, unit: LengthDisplayUnit): number {
  return unit === "in" ? value * CM_PER_IN : value;
}

/** Round to the precision the figure is read at, so a typed 70.0 kg stored as 70 does not come back as 154.3 then 69.99. */
export function roundForStorage(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Same rounding the home tiles already use (round half up on the scaled value), so 36.65 shows as 36.7 everywhere. */
function oneDecimal(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

function ok(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** One decimal for weight and temperature, a whole number for lengths (as the existing tiles already show them). */
export function formatWeight(kg: number | null | undefined, unit: WeightDisplayUnit, withUnit = true): string | null {
  if (!ok(kg)) return null;
  const v = oneDecimal(weightFromKg(kg, unit));
  return withUnit ? `${v} ${WEIGHT_UNIT_LABEL[unit]}` : v;
}
export function formatTemperature(c: number | null | undefined, unit: TemperatureDisplayUnit, withUnit = true): string | null {
  if (!ok(c)) return null;
  const v = oneDecimal(temperatureFromC(c, unit));
  return withUnit ? `${v} ${TEMPERATURE_UNIT_LABEL[unit]}` : v;
}
export function formatLength(cm: number | null | undefined, unit: LengthDisplayUnit, withUnit = true): string | null {
  if (!ok(cm)) return null;
  const v = String(Math.round(lengthFromCm(cm, unit)));
  return withUnit ? `${v} ${LENGTH_UNIT_LABEL[unit]}` : v;
}
