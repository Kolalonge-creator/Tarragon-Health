/**
 * Device reading plausibility (S70a, function 18.9). Pure and deterministic: no language model, no clock, no network (INV-01).
 *
 * Two classes, from the PROPOSED configuration `devices.plausibility`:
 *  - "impossible": a value no living person can have, almost always an error code, a unit mix-up or a typing slip. It is HELD as
 *    "please confirm", never triaged and not saved to the record until the person re-checks it.
 *  - "ok": everything else, including extreme-but-possible values. Those are saved and triaged exactly like a typed reading, so a real
 *    crisis is never blocked by this module.
 *
 * The database holds the same table (device_config key devices.plausibility) and a BEFORE INSERT trigger that applies it to every
 * insert path; this function lets the apps tell the person at once, offline. A test compares the two seeds.
 */
import { getProposedConfig } from "./proposed-config";

export type PlausibilityVital = "blood_pressure" | "glucose" | "weight" | "pulse" | "temperature" | "spo2";

export interface PlausibilityCandidate {
  vitalType: PlausibilityVital;
  systolic?: number | null;
  diastolic?: number | null;
  glucoseMmolL?: number | null;
  weightKg?: number | null;
  pulseBpm?: number | null;
  temperatureC?: number | null;
  spo2Pct?: number | null;
  /** Whole years, or null/undefined when unknown. Child weights are never held, and neither is an unknown age. */
  ageYears?: number | null;
}

export type ImpossibleReason =
  | "systolic_range"
  | "diastolic_range"
  | "systolic_not_above_diastolic"
  | "pulse_range"
  | "spo2_range"
  | "temperature_range"
  | "weight_range"
  | "glucose_range";

export interface PlausibilityResult {
  class: "ok" | "impossible";
  reasons: ImpossibleReason[];
  /** Version of devices.plausibility used (INV-16). */
  configVersion: number;
}

interface Range {
  min: number;
  max: number;
}
export interface PlausibilityConfig {
  impossible: {
    systolic_mmhg: Range;
    diastolic_mmhg: Range;
    systolic_must_exceed_diastolic: boolean;
    pulse_bpm: Range;
    spo2_pct: Range;
    temperature_c: Range;
    weight_kg_adult: Range;
    glucose_mmol_l: Range;
  };
  adult_age_years: number;
  wrist_ppg_spo2_informational: boolean;
}

export function loadPlausibilityConfig(asOf?: string): { config: PlausibilityConfig; version: number } {
  const resolved = getProposedConfig("devices.plausibility", asOf);
  return { config: resolved.value as unknown as PlausibilityConfig, version: resolved.version };
}

const out = (v: number | null | undefined, r: Range): boolean => v != null && Number.isFinite(v) && (v < r.min || v > r.max);

export function classifyPlausibility(c: PlausibilityCandidate, loaded = loadPlausibilityConfig()): PlausibilityResult {
  const { config, version } = loaded;
  const lim = config.impossible;
  const reasons: ImpossibleReason[] = [];
  switch (c.vitalType) {
    case "blood_pressure":
      if (out(c.systolic, lim.systolic_mmhg)) reasons.push("systolic_range");
      if (out(c.diastolic, lim.diastolic_mmhg)) reasons.push("diastolic_range");
      if (lim.systolic_must_exceed_diastolic && c.systolic != null && c.diastolic != null && c.systolic <= c.diastolic) {
        reasons.push("systolic_not_above_diastolic");
      }
      if (out(c.pulseBpm, lim.pulse_bpm)) reasons.push("pulse_range");
      break;
    case "pulse":
      if (out(c.pulseBpm, lim.pulse_bpm)) reasons.push("pulse_range");
      break;
    case "spo2":
      if (out(c.spo2Pct, lim.spo2_pct)) reasons.push("spo2_range");
      if (out(c.pulseBpm, lim.pulse_bpm)) reasons.push("pulse_range");
      break;
    case "temperature":
      if (out(c.temperatureC, lim.temperature_c)) reasons.push("temperature_range");
      break;
    case "weight":
      // Only a known adult is held: a small child's weight is real, and an unknown age fails open (saved, never held).
      if (c.ageYears != null && c.ageYears >= config.adult_age_years && out(c.weightKg, lim.weight_kg_adult)) reasons.push("weight_range");
      break;
    case "glucose":
      if (out(c.glucoseMmolL, lim.glucose_mmol_l)) reasons.push("glucose_range");
      break;
  }
  return { class: reasons.length > 0 ? "impossible" : "ok", reasons, configVersion: version };
}

/**
 * Wrist optical SpO2 is informational only (A12): it never triggers amber or red on its own, and the person is asked to recheck with a
 * fingertip oximeter. Any SpO2 that arrives through a wearable or a health-data aggregator is treated as wrist/optical. A fingertip
 * oximeter paired by Bluetooth (source "device") is not.
 */
export function isInformationalSpo2(source: string, loaded = loadPlausibilityConfig()): boolean {
  return loaded.config.wrist_ppg_spo2_informational && (source === "wearable" || source === "apple_health" || source === "android_health_connect");
}

export const RECHECK_WITH_FINGERTIP_OXIMETER =
  "This reading comes from a wrist or watch sensor, which can be less accurate. Please check again with a fingertip pulse oximeter. If you feel short of breath, get care now.";

export const HELD_READING_COPY = {
  title: "Please check this reading",
  body: "This number does not look possible, so we have not added it to your record. Check your device or the number you typed and enter it again.",
  retry: "Enter it again",
  discard: "It was a mistake, leave it out",
} as const;
