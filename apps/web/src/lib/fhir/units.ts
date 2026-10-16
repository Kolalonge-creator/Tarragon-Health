/**
 * Units for FHIR exchange (S44, spec 2.10: "round trip preserves observation values and units").
 *
 * UCUM is the unit system FHIR expects on a Quantity. This file does two jobs and nothing else:
 *   1. `canonicalUnit` names the one UCUM unit each platform vital is stored in (what export writes).
 *   2. `convertToCanonical` takes a value and the unit an outside system sent it in and returns the value in the stored unit, or
 *      `null` when the unit is unknown or missing. It NEVER guesses: an unknown or absent unit is a refusal, so a glucose of 126
 *      mg/dL can no longer be filed as 126 mmol/L (the old import ignored units altogether).
 *
 * The factors are fixed physical constants (not clinical thresholds), so they live in code and are covered by tests.
 */
import { mgDlToMmolL, type Database } from "@tarragon/shared";

type VitalType = Database["public"]["Enums"]["vital_type"];

export interface UcumUnit {
  /** The UCUM code written to Quantity.code. */
  code: string;
  /** The human unit written to Quantity.unit. */
  display: string;
}

/** The unit each importable or exportable vital is stored in. */
export const CANONICAL_UNIT: Partial<Record<VitalType, UcumUnit>> = {
  blood_pressure: { code: "mm[Hg]", display: "mmHg" },
  pulse: { code: "/min", display: "beats/min" },
  glucose: { code: "mmol/L", display: "mmol/L" },
  weight: { code: "kg", display: "kg" },
  temperature: { code: "Cel", display: "°C" },
  spo2: { code: "%", display: "%" },
  waist_circumference: { code: "cm", display: "cm" },
  respiratory_rate: { code: "/min", display: "breaths/min" },
  peak_flow: { code: "L/min", display: "L/min" },
};

/** Spellings of a unit that mean the same thing, lower-cased and trimmed, mapped to one UCUM-style key. */
const ALIASES: Record<string, string> = {
  "mm[hg]": "mm[Hg]",
  mmhg: "mm[Hg]",
  "mm hg": "mm[Hg]",
  "/min": "/min",
  "beats/min": "/min",
  "{beats}/min": "/min",
  bpm: "/min",
  "breaths/min": "/min",
  "{breaths}/min": "/min",
  "mmol/l": "mmol/L",
  "mg/dl": "mg/dL",
  kg: "kg",
  "[lb_av]": "[lb_av]",
  lb: "[lb_av]",
  lbs: "[lb_av]",
  cel: "Cel",
  "°c": "Cel",
  c: "Cel",
  "[degf]": "[degF]",
  "°f": "[degF]",
  f: "[degF]",
  "%": "%",
  cm: "cm",
  "[in_i]": "[in_i]",
  in: "[in_i]",
  "l/min": "L/min",
};

const KG_PER_LB = 0.45359237; // exact, by definition of the avoirdupois pound
const CM_PER_INCH = 2.54; // exact, by definition

export function normaliseUnitKey(unit: string | undefined | null, code?: string | undefined | null): string | null {
  for (const candidate of [code, unit]) {
    const key = candidate?.trim().toLowerCase();
    if (key && key in ALIASES) return ALIASES[key] ?? null;
  }
  return null;
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export interface Conversion {
  value: number;
  /** Set when the value was converted, so a reviewing clinician sees it. */
  warning: string | null;
}

/**
 * `null` means "cannot tell what this is" and the caller must skip the entry with a reason. Conversions that are exact keep their precision to
 * the places a person or device would report; nothing is rounded to fewer places than the stored column holds.
 */
export function convertToCanonical(vital: VitalType, value: number, unit: string | undefined | null, code?: string | undefined | null): Conversion | null {
  const key = normaliseUnitKey(unit, code);
  if (!key) return null;
  switch (vital) {
    case "blood_pressure":
      return key === "mm[Hg]" ? { value, warning: null } : null;
    case "pulse":
    case "respiratory_rate":
      return key === "/min" ? { value, warning: null } : null;
    case "glucose":
      if (key === "mmol/L") return { value, warning: null };
      if (key === "mg/dL") return { value: mgDlToMmolL(value), warning: `glucose converted from ${value} mg/dL to mmol/L` };
      return null;
    case "weight":
      if (key === "kg") return { value, warning: null };
      if (key === "[lb_av]") return { value: round(value * KG_PER_LB, 2), warning: `weight converted from ${value} lb to kg` };
      return null;
    case "temperature":
      if (key === "Cel") return { value, warning: null };
      if (key === "[degF]") return { value: round(((value - 32) * 5) / 9, 1), warning: `temperature converted from ${value} degrees F to degrees C` };
      return null;
    case "spo2":
      return key === "%" ? { value, warning: null } : null;
    case "waist_circumference":
      if (key === "cm") return { value, warning: null };
      if (key === "[in_i]") return { value: round(value * CM_PER_INCH, 1), warning: `waist converted from ${value} in to cm` };
      return null;
    case "peak_flow":
      return key === "L/min" ? { value, warning: null } : null;
    default:
      return null;
  }
}

/** UCUM code for a stored lab unit (the panel units of S27), so a Quantity is valid UCUM. Unknown units are kept as the text unit only. */
const LAB_UCUM: Record<string, string> = {
  "mg/dL": "mg/dL",
  "mmol/L": "mmol/L",
  "%": "%",
  "U/L": "U/L",
  "g/dL": "g/dL",
  "10^9/L": "10*9/L",
  "mIU/L": "m[IU]/L",
};

export function labUnitToUcum(unit: string): string | null {
  return LAB_UCUM[unit] ?? null;
}
