/**
 * Lab result release rules (S27, spec 4.4, INV-03 and INV-04). Pure code: no database, no model, no clock.
 * `private.classify_lab_result` in the database applies the same rule and is the one that decides; this module is the
 * mirror used by the screens (to show a lab what will happen) and by the tests that pin both to the same fixtures.
 */

export type LabAnalyteDefinition = {
  code: string;
  label: string;
  kind: "numeric" | "qualitative";
  unit: string;
  refLow?: number;
  refHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  sensitive?: boolean;
  optional?: boolean;
};

export type LabPanelDefinition = { analytes: LabAnalyteDefinition[] };

export type LabItemInput = { analyteCode: string; valueNumeric?: number | null; valueText?: string | null; unit?: string | null };

export type LabFlag = "normal" | "low" | "high" | "critical" | "positive" | "negative";

export type LabReleaseState = "awaiting_review" | "released" | "clinician_disclosure_required";

export type ClassifiedItem = {
  analyteCode: string;
  flag: LabFlag;
  sensitivePositive: boolean;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
};

export type LabClassification = {
  releaseState: LabReleaseState;
  /** RES-001 only for an automatic release; the others name why the result is held. */
  reason: "RES-001" | "sensitive_positive" | "abnormal" | "critical" | "incomplete";
  items: ClassifiedItem[];
  missingRequired: string[];
  /** The task the database creates for this result, or null when it is released at once. */
  task: "sensitive_result_disclosure" | "critical_result_review" | "routine_result_review" | null;
};

export class LabEntryError extends Error {
  constructor(public readonly code: "lab_unknown_analyte" | "lab_unit_mismatch" | "lab_value_missing" | "lab_value_not_recognised" | "lab_duplicate_analyte" | "lab_value_out_of_bounds", detail: string) {
    super(`${code}: ${detail}`);
  }
}

/** Values the form may send for a qualitative analyte. Anything else is refused, never guessed (OQ-176). */
export const QUALITATIVE_VALUES = ["positive", "negative"] as const;

function flagNumeric(def: LabAnalyteDefinition, v: number): LabFlag {
  if (def.criticalLow !== undefined && v < def.criticalLow) return "critical";
  if (def.criticalHigh !== undefined && v > def.criticalHigh) return "critical";
  if (def.refLow !== undefined && v < def.refLow) return "low";
  if (def.refHigh !== undefined && v > def.refHigh) return "high";
  return "normal";
}

export function classifyLabResult(panel: LabPanelDefinition, input: LabItemInput[]): LabClassification {
  const byCode = new Map(panel.analytes.map((a) => [a.code, a]));
  const seen = new Set<string>();
  const items: ClassifiedItem[] = [];

  for (const it of input) {
    const def = byCode.get(it.analyteCode);
    if (!def) throw new LabEntryError("lab_unknown_analyte", it.analyteCode);
    if (seen.has(it.analyteCode)) throw new LabEntryError("lab_duplicate_analyte", it.analyteCode);
    seen.add(it.analyteCode);
    if (it.unit != null && it.unit !== "" && it.unit !== def.unit) throw new LabEntryError("lab_unit_mismatch", `${it.analyteCode} expects ${def.unit}`);

    if (def.kind === "numeric") {
      const v = it.valueNumeric;
      if (v == null) throw new LabEntryError("lab_value_missing", it.analyteCode);
      if (!Number.isFinite(v) || v < 0 || v > 1e6) throw new LabEntryError("lab_value_out_of_bounds", it.analyteCode);
      items.push({ analyteCode: def.code, flag: flagNumeric(def, v), sensitivePositive: false, unit: def.unit, refLow: def.refLow ?? null, refHigh: def.refHigh ?? null });
    } else {
      const t = it.valueText?.trim().toLowerCase();
      if (t == null || t === "") throw new LabEntryError("lab_value_missing", it.analyteCode);
      if (t !== "positive" && t !== "negative") throw new LabEntryError("lab_value_not_recognised", it.analyteCode);
      items.push({ analyteCode: def.code, flag: t, sensitivePositive: t === "positive" && def.sensitive === true, unit: def.unit, refLow: null, refHigh: null });
    }
  }

  const missingRequired = panel.analytes.filter((a) => !a.optional && !seen.has(a.code)).map((a) => a.code);

  if (items.some((i) => i.sensitivePositive)) {
    return { releaseState: "clinician_disclosure_required", reason: "sensitive_positive", items, missingRequired, task: "sensitive_result_disclosure" };
  }
  if (items.some((i) => i.flag === "critical")) {
    return { releaseState: "awaiting_review", reason: "critical", items, missingRequired, task: "critical_result_review" };
  }
  if (items.some((i) => i.flag !== "normal" && i.flag !== "negative")) {
    return { releaseState: "awaiting_review", reason: "abnormal", items, missingRequired, task: "routine_result_review" };
  }
  if (missingRequired.length > 0 || items.length === 0) {
    return { releaseState: "awaiting_review", reason: "incomplete", items, missingRequired, task: "routine_result_review" };
  }
  return { releaseState: "released", reason: "RES-001", items, missingRequired, task: null };
}

/** Whether any recorded audio or AI explanation may be offered for a result (INV-04). */
export function explanationAllowed(items: { sensitivePositive: boolean }[], releaseState: LabReleaseState | "withheld"): boolean {
  return releaseState === "released" && !items.some((i) => i.sensitivePositive);
}
