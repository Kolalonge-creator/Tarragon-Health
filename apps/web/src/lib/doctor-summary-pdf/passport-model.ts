import { trustOf, type BpTrust } from "./model";

/**
 * Result passport (item 10): the blood sugar and lab sections of the patient-built PDF. Everything here is pure. It describes; it never
 * grades. There is no "high", "normal" or "controlled" in this file; a lab line carries only the flag and range the laboratory printed.
 */

/** Most blood sugar lines printed, and most lab lines printed. Not clinical thresholds: only how much fits on a page. */
export const PASSPORT_LIMITS = { glucoseRows: 30, labRows: 40 } as const; // band-ok: how many lines fit on a page, not a clinical threshold

const MG_DL_PER_MMOL = 18.0182;

export interface GlucoseReadingIn {
  takenAt: string;
  mmolL: number | null;
  context: string | null;
  source: string;
  validationStatus: string;
}
export interface GlucoseLine { takenAt: string; mmolL: number; mgDl: number; context: string | null; trust: BpTrust }
export interface GlucoseSection {
  lines: GlucoseLine[];
  totalListed: number;
  notCounted: number;
  /** Lowest and highest of the valid readings, in mmol/L. Described, never graded, and never an average: fasting and after-meal readings differ. */
  lowest: number | null;
  highest: number | null;
  truncated: boolean;
  capped: boolean;
}

const GLUCOSE_CONTEXT: Record<string, string> = { fasting: "fasting", random: "random", post_meal: "after a meal", bedtime: "at bedtime" };

export function buildGlucoseSection(readings: readonly GlucoseReadingIn[], maxRows: number = PASSPORT_LIMITS.glucoseRows, capped = false): GlucoseSection {
  const usable = readings.filter((r) => r.validationStatus === "valid" && r.mmolL != null && Number.isFinite(r.mmolL) && Number.isFinite(Date.parse(r.takenAt)));
  usable.sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
  const values = usable.map((r) => r.mmolL as number);
  return {
    lines: usable.slice(0, maxRows).map((r) => ({
      takenAt: r.takenAt,
      mmolL: Math.round((r.mmolL as number) * 10) / 10,
      mgDl: Math.round((r.mmolL as number) * MG_DL_PER_MMOL),
      context: r.context ? GLUCOSE_CONTEXT[r.context] ?? null : null,
      trust: trustOf(r.source),
    })),
    totalListed: usable.length,
    notCounted: readings.length - usable.length,
    lowest: values.length ? Math.round(Math.min(...values) * 10) / 10 : null,
    highest: values.length ? Math.round(Math.max(...values) * 10) / 10 : null,
    truncated: usable.length > maxRows,
    capped,
  };
}

/**
 * The analytes that may print on a passport. An ALLOW-LIST, like the symptom types in model.ts: a code on neither list (a reproductive
 * hormone, a pregnancy test, an infection screen, anything added later) is left out until someone decides it is safe, never printed by
 * default. Sensitive positive results (HIV, hepatitis B surface antigen, hepatitis C antibody; INV-04) are also filtered by the query and by
 * row level security, so they cannot reach this function. The patient is not offered a way to add either kind in this build (OQ-PASSPORT-2).
 */
export const PASSPORT_LAB_CODES: readonly string[] = [
  "hba1c", "fasting_glucose", "glucose", "creatinine", "egfr", "urea", "sodium", "potassium", "alt", "ast", "haemoglobin",
  "total_cholesterol", "ldl_cholesterol", "hdl_cholesterol", "triglycerides", "non_hdl_cholesterol",
];

export interface LabReadingIn {
  code: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  referenceRangeText: string | null;
  rangeSource: string | null;
  rangeSourceRef: string | null;
  abnormalFlag: string | null;
  takenAt: string;
  laboratory: string | null;
  sensitivePositive: boolean;
}
export interface LabLine {
  label: string;
  result: string;
  takenAt: string;
  laboratory: string | null;
  /** The range as printed by its source, and who set it. Null when that source may not be shown as clinical. */
  range: { text: string; source: string } | null;
  flag: string | null;
}
export interface LabSection { lines: LabLine[]; leftOut: number; truncated: boolean; capped: boolean }

function labLabel(code: string): string {
  if (code === "hba1c") return "HbA1c";
  if (code === "egfr") return "eGFR";
  if (code === "alt" || code === "ast") return code.toUpperCase();
  const words = code.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One line per test: the newest result. `showRange` is `rangeMayBeShownAsClinical` and `describe` is `rangeSourceLabel`, passed in so this
 * file has no package imports and the rule is the one the shared link already uses.
 */
export function buildLabSection(
  rows: readonly LabReadingIn[],
  helpers: { showRange: (source: string | null) => boolean; describe: (source: string | null, ref: string | null) => string },
  maxRows: number = PASSPORT_LIMITS.labRows,
  capped = false,
): LabSection {
  // Belt and braces: the query already drops sensitive rows; one that slips through is dropped here and is not even counted as "left out".
  const safe = rows.filter((r) => !r.sensitivePositive && Number.isFinite(Date.parse(r.takenAt)));
  const allowed = safe.filter((r) => PASSPORT_LAB_CODES.includes(r.code));
  const newest = new Map<string, LabReadingIn>();
  for (const r of [...allowed].sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt))) if (!newest.has(r.code)) newest.set(r.code, r);
  const all = [...newest.values()].sort((a, b) => labLabel(a.code).localeCompare(labLabel(b.code)));
  return {
    lines: all.slice(0, maxRows).map((r) => ({
      label: labLabel(r.code),
      result: `${r.valueText ?? (r.value != null ? String(r.value) : "no value")}${r.unit ? ` ${r.unit}` : ""}`,
      takenAt: r.takenAt,
      laboratory: r.laboratory,
      range: r.referenceRangeText && helpers.showRange(r.rangeSource) ? { text: r.referenceRangeText, source: helpers.describe(r.rangeSource, r.rangeSourceRef) } : null,
      flag: r.abnormalFlag,
    })),
    leftOut: new Set(safe.filter((r) => !PASSPORT_LAB_CODES.includes(r.code)).map((r) => r.code)).size,
    truncated: all.length > maxRows,
    capped,
  };
}
