/**
 * Lipids as a cardiovascular-risk module — shared domain constants.
 *
 * Cholesterol is NOT a standalone service line in Tarragon. Lipid values are
 * stored as ordinary rows in `lab_analyte_readings` (the same longitudinal,
 * timestamped, per-analyte store HbA1c uses) and feed the shared CV-risk
 * profile. This module is the single source of truth for the lipid analyte
 * codes, their display metadata, and the Non-HDL derivation — reused by the
 * detection UI (Phase 1) and the CV-risk stratification engine (Phase 3).
 *
 * Canonical unit is mg/dL (what the screening-result form collects and what
 * `submitScreeningResult` writes). Clinical thresholds/targets are NOT here —
 * those live in the Medical-Director-signed `cv_risk_config` table so they can
 * be set and signed off without a code change (see Phase 3).
 */

export const LIPID_ANALYTE_CODES = [
  "total_cholesterol",
  "ldl_cholesterol",
  "hdl_cholesterol",
  "triglycerides",
  "non_hdl_cholesterol",
] as const;

export type LipidAnalyteCode = (typeof LIPID_ANALYTE_CODES)[number];

export const LIPID_ANALYTE_META: Record<
  LipidAnalyteCode,
  { label: string; short: string; unit: string; computed?: boolean }
> = {
  total_cholesterol: { label: "Total cholesterol", short: "Total", unit: "mg/dL" },
  ldl_cholesterol: { label: "LDL cholesterol", short: "LDL", unit: "mg/dL" },
  hdl_cholesterol: { label: "HDL cholesterol", short: "HDL", unit: "mg/dL" },
  triglycerides: { label: "Triglycerides", short: "Trig", unit: "mg/dL" },
  non_hdl_cholesterol: {
    label: "Non-HDL cholesterol",
    short: "Non-HDL",
    unit: "mg/dL",
    computed: true,
  },
};

/**
 * Non-HDL cholesterol = Total cholesterol − HDL cholesterol. The single
 * best lipid predictor of atherosclerotic risk (captures all atherogenic
 * particles), and — unlike a directly-measured LDL — it stays valid in the
 * non-fasting state. Returns null unless both inputs are present.
 */
export function computeNonHdl(
  totalCholesterolMgDl: number | null | undefined,
  hdlCholesterolMgDl: number | null | undefined
): number | null {
  if (
    totalCholesterolMgDl === null ||
    totalCholesterolMgDl === undefined ||
    hdlCholesterolMgDl === null ||
    hdlCholesterolMgDl === undefined
  ) {
    return null;
  }
  const value = totalCholesterolMgDl - hdlCholesterolMgDl;
  return value >= 0 ? Math.round(value * 10) / 10 : null;
}

export function isLipidAnalyteCode(code: string): code is LipidAnalyteCode {
  return (LIPID_ANALYTE_CODES as readonly string[]).includes(code);
}
