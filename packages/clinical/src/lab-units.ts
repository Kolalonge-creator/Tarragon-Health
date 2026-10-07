/**
 * Lab units (founder decision 2026-10-07). The platform stores and judges every numeric lab value in ONE canonical unit per
 * analyte, the one Nigerian laboratories most often print (mg/dL for glucose, creatinine and lipids; mmol/L for sodium and
 * potassium; g/dL for haemoglobin; 10^9/L for blood counts; % for HbA1c). A lab that prints a value in another unit, for
 * example glucose in mmol/L or creatinine in µmol/L, is converted here before the value reaches the database, so the
 * release rule (INV-03) always compares like with like. The unit the lab used is kept by the caller as the "entered" unit
 * so the original can be shown back.
 *
 * Pure code: no database, no clock, no model. Conversion factors are physical constants (molar masses), not clinical
 * judgement, so they are not PROPOSED configuration:
 *   glucose        1 mmol/L = 18.016 mg/dL      (molar mass 180.16 g/mol)
 *   creatinine     1 mg/dL  = 88.4 µmol/L       (molar mass 113.12 g/mol)
 *   cholesterol    1 mmol/L = 38.67 mg/dL       (total, LDL, HDL)
 *   triglycerides  1 mmol/L = 88.57 mg/dL
 *   haemoglobin    1 g/dL   = 10 g/L
 *   HbA1c          NGSP % = 0.09148 x IFCC mmol/mol + 2.152 (IFCC/NGSP master equation)
 *   counts         10^9/L = 10^3/µL = K/µL; cells/µL = 1000 x 10^9/L
 */
import { LabEntryError } from "./lab-release";

export type LabUnitConversion = {
  /** The unit label as the panel stores it. */
  canonical: string;
  /** Decimal places kept after converting into the canonical unit (what a lab prints for that analyte). */
  decimals: number;
  /** Other units a laboratory may print, as normalised labels (see `normaliseUnitLabel`). */
  alternates: Record<string, (value: number) => number>;
  /** And back, for showing a stored value in the unit the patient or lab prefers. */
  fromCanonical: Record<string, (value: number) => number>;
};

const MG_DL_PER_MMOL_GLUCOSE = 18.016;
const UMOL_L_PER_MG_DL_CREATININE = 88.4;
const MG_DL_PER_MMOL_CHOLESTEROL = 38.67;
const MG_DL_PER_MMOL_TRIGLYCERIDES = 88.57;

const same = (v: number) => v;

export const LAB_UNIT_CONVERSIONS: Record<string, LabUnitConversion> = {
  fasting_glucose: {
    canonical: "mg/dL",
    decimals: 0,
    alternates: { "mmol/l": (v) => v * MG_DL_PER_MMOL_GLUCOSE },
    fromCanonical: { "mmol/l": (v) => v / MG_DL_PER_MMOL_GLUCOSE },
  },
  hba1c: {
    canonical: "%",
    decimals: 1,
    alternates: { "mmol/mol": (v) => 0.09148 * v + 2.152 },
    fromCanonical: { "mmol/mol": (v) => (v - 2.152) / 0.09148 },
  },
  creatinine: {
    canonical: "mg/dL",
    decimals: 2,
    alternates: { "umol/l": (v) => v / UMOL_L_PER_MG_DL_CREATININE },
    fromCanonical: { "umol/l": (v) => v * UMOL_L_PER_MG_DL_CREATININE },
  },
  potassium: { canonical: "mmol/L", decimals: 1, alternates: { "meq/l": same }, fromCanonical: { "meq/l": same } },
  sodium: { canonical: "mmol/L", decimals: 0, alternates: { "meq/l": same }, fromCanonical: { "meq/l": same } },
  total_cholesterol: {
    canonical: "mg/dL",
    decimals: 0,
    alternates: { "mmol/l": (v) => v * MG_DL_PER_MMOL_CHOLESTEROL },
    fromCanonical: { "mmol/l": (v) => v / MG_DL_PER_MMOL_CHOLESTEROL },
  },
  ldl_cholesterol: {
    canonical: "mg/dL",
    decimals: 0,
    alternates: { "mmol/l": (v) => v * MG_DL_PER_MMOL_CHOLESTEROL },
    fromCanonical: { "mmol/l": (v) => v / MG_DL_PER_MMOL_CHOLESTEROL },
  },
  hdl_cholesterol: {
    canonical: "mg/dL",
    decimals: 0,
    alternates: { "mmol/l": (v) => v * MG_DL_PER_MMOL_CHOLESTEROL },
    fromCanonical: { "mmol/l": (v) => v / MG_DL_PER_MMOL_CHOLESTEROL },
  },
  triglycerides: {
    canonical: "mg/dL",
    decimals: 0,
    alternates: { "mmol/l": (v) => v * MG_DL_PER_MMOL_TRIGLYCERIDES },
    fromCanonical: { "mmol/l": (v) => v / MG_DL_PER_MMOL_TRIGLYCERIDES },
  },
  alt: { canonical: "U/L", decimals: 0, alternates: { "iu/l": same, "ukat/l": (v) => v * 60 }, fromCanonical: { "iu/l": same, "ukat/l": (v) => v / 60 } },
  ast: { canonical: "U/L", decimals: 0, alternates: { "iu/l": same, "ukat/l": (v) => v * 60 }, fromCanonical: { "iu/l": same, "ukat/l": (v) => v / 60 } },
  haemoglobin: {
    canonical: "g/dL",
    decimals: 1,
    alternates: { "g/l": (v) => v / 10 },
    fromCanonical: { "g/l": (v) => v * 10 },
  },
  wbc: {
    canonical: "10^9/L",
    decimals: 1,
    alternates: { "10^3/ul": same, "k/ul": same, "cells/ul": (v) => v / 1000, "/ul": (v) => v / 1000 },
    fromCanonical: { "10^3/ul": same, "k/ul": same, "cells/ul": (v) => v * 1000, "/ul": (v) => v * 1000 },
  },
  platelets: {
    canonical: "10^9/L",
    decimals: 0,
    alternates: { "10^3/ul": same, "k/ul": same, "cells/ul": (v) => v / 1000, "/ul": (v) => v / 1000 },
    fromCanonical: { "10^3/ul": same, "k/ul": same, "cells/ul": (v) => v * 1000, "/ul": (v) => v * 1000 },
  },
  tsh: { canonical: "mIU/L", decimals: 2, alternates: { "uiu/ml": same, "miu/ml": (v) => v * 1000 }, fromCanonical: { "uiu/ml": same, "miu/ml": (v) => v / 1000 } },
};

/**
 * One label for one unit however a lab spells it: case folded, micro sign and "u" unified, spaces and "x" prefixes dropped,
 * `10*9/L`, `x10^9/L`, `10E9/L` and `10⁹/L` all read as `10^9/l`.
 */
export function normaliseUnitLabel(unit: string): string {
  return unit
    .trim()
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/\s+/g, "")
    .replace(/^x/, "")
    .replace(/10\*9|10e9|10⁹/g, "10^9")
    .replace(/10\*3|10e3|10³/g, "10^3");
}

export type NormalisedLabValue = {
  /** The value in the analyte's canonical unit, rounded to the analyte's printed precision. */
  value: number;
  unit: string;
  /** True when the lab's unit differed and the value was converted. */
  converted: boolean;
  /** The unit as the lab supplied it, or null when none was given (taken as canonical). */
  enteredUnit: string | null;
  /** The value exactly as entered, before conversion. */
  enteredValue: number;
};

const roundTo = (v: number, d: number): number => {
  const f = 10 ** d;
  return Math.round((v + Number.EPSILON) * f) / f;
};

/**
 * Brings a lab-entered numeric value into the analyte's canonical unit. An empty unit means "as in the panel". A unit this
 * module does not know is refused, never guessed (`lab_unit_mismatch`), so a typo cannot slip a wrong number through.
 */
export function toCanonicalUnit(analyteCode: string, value: number, unit?: string | null): NormalisedLabValue {
  const spec = LAB_UNIT_CONVERSIONS[analyteCode];
  const entered = unit != null && unit.trim() !== "" ? unit.trim() : null;
  if (!spec) {
    if (entered === null) return { value, unit: "", converted: false, enteredUnit: null, enteredValue: value };
    throw new LabEntryError("lab_unknown_analyte", analyteCode);
  }
  if (entered === null || normaliseUnitLabel(entered) === normaliseUnitLabel(spec.canonical)) {
    return { value, unit: spec.canonical, converted: false, enteredUnit: entered, enteredValue: value };
  }
  const convert = spec.alternates[normaliseUnitLabel(entered)];
  if (!convert) throw new LabEntryError("lab_unit_mismatch", `${analyteCode} accepts ${[spec.canonical, ...Object.keys(spec.alternates)].join(", ")}`);
  return { value: roundTo(convert(value), spec.decimals), unit: spec.canonical, converted: true, enteredUnit: entered, enteredValue: value };
}

/** A stored canonical value shown in another known unit (for the screens). Returns null for a unit that is not known. */
export function fromCanonicalUnit(analyteCode: string, canonicalValue: number, targetUnit: string): number | null {
  const spec = LAB_UNIT_CONVERSIONS[analyteCode];
  if (!spec) return null;
  const key = normaliseUnitLabel(targetUnit);
  if (key === normaliseUnitLabel(spec.canonical)) return canonicalValue;
  const back = spec.fromCanonical[key];
  return back ? roundTo(back(canonicalValue), key === "mmol/mol" ? 0 : key === "mmol/l" ? 2 : 1) : null;
}

/** Units a lab may use for an analyte, canonical first, for a select box or a hint. */
export function acceptedUnits(analyteCode: string): string[] {
  const spec = LAB_UNIT_CONVERSIONS[analyteCode];
  return spec ? [spec.canonical, ...Object.keys(spec.alternates)] : [];
}
