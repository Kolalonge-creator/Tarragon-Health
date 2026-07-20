/**
 * Diabetes pathway §13.5 / §15.4 — drug-safety cautions for the glucose-
 * lowering ladder, as a PURE function so it is unit-testable and stays the
 * single source of truth. Surfaced to the CLINICIAN at prescribe/review time
 * (advisory, not a hard block) — the platform never auto-blocks a prescription;
 * a doctor decides, exactly like the tier/authority pattern elsewhere.
 *
 * eGFR / pregnancy / acute-illness context is optional: when unknown, the
 * general cautions still show and the eGFR-specific ones are simply omitted
 * (never a false "safe").
 */

export type DrugSafetySeverity = "contraindicated" | "caution" | "info";

export interface DrugSafetyWarning {
  severity: DrugSafetySeverity;
  message: string;
}

export interface DrugSafetyContext {
  /** Latest known eGFR (mL/min/1.73m²), if any. */
  egfr?: number | null;
  pregnant?: boolean;
  /** Acutely unwell / dehydrated / fasting / peri-operative / pre-contrast. */
  acutelyUnwell?: boolean;
}

type DrugClass = "metformin" | "sulfonylurea" | "sglt2" | "dpp4" | "insulin" | "ace_arb" | null;

/** Classify a free-text drug name into the ladder class it belongs to. */
export function classifyDiabetesDrug(drugName: string): DrugClass {
  const n = drugName.trim().toLowerCase();
  if (!n) return null;
  if (n.includes("metformin")) return "metformin";
  if (/gliclazide|glibenclamide|glimepiride|glipizide|glyburide/.test(n)) return "sulfonylurea";
  if (/gliflozin|empagliflozin|dapagliflozin|canagliflozin|ertugliflozin/.test(n)) return "sglt2";
  if (/gliptin|sitagliptin|vildagliptin|linagliptin|saxagliptin|alogliptin/.test(n)) return "dpp4";
  if (n.includes("insulin")) return "insulin";
  if (/pril\b|sartan\b|ramipril|lisinopril|enalapril|perindopril|losartan|valsartan|telmisartan/.test(n))
    return "ace_arb";
  return null;
}

export function diabetesDrugSafety(drugName: string, ctx: DrugSafetyContext = {}): DrugSafetyWarning[] {
  const cls = classifyDiabetesDrug(drugName);
  if (!cls) return [];
  const warnings: DrugSafetyWarning[] = [];
  const { egfr, pregnant, acutelyUnwell } = ctx;

  switch (cls) {
    case "metformin":
      if (egfr != null && egfr < 30)
        warnings.push({ severity: "contraindicated", message: "eGFR < 30 — do not start metformin; stop if already on it (lactic-acidosis risk)." });
      else if (egfr != null && egfr < 45)
        warnings.push({ severity: "caution", message: "eGFR 30–45 — review/reduce the metformin dose and monitor renal function closely." });
      if (acutelyUnwell)
        warnings.push({ severity: "caution", message: "Withhold metformin in acute illness, dehydration, sepsis, or before contrast imaging (lactic-acidosis risk)." });
      if (pregnant)
        warnings.push({ severity: "caution", message: "In pregnancy, use metformin only if the obstetric team advises; insulin is the mainstay." });
      warnings.push({ severity: "info", message: "Check renal function before starting and at least annually; consider B12 on long-term use; GI upset is common." });
      break;
    case "sulfonylurea":
      warnings.push({ severity: "caution", message: "Hypoglycaemia risk — worse in the elderly, renal impairment, skipped meals, or with alcohol; can cause weight gain." });
      if (/glibenclamide|glyburide/.test(drugName.toLowerCase()))
        warnings.push({ severity: "caution", message: "Glibenclamide has the highest hypo risk — prefer gliclazide, especially in older / renal-impaired patients." });
      if (pregnant)
        warnings.push({ severity: "contraindicated", message: "Avoid in pregnancy — switch to insulin." });
      break;
    case "sglt2":
      warnings.push({ severity: "caution", message: "STOP when acutely unwell, fasting, or before surgery — euglycaemic DKA risk." });
      if (acutelyUnwell)
        warnings.push({ severity: "caution", message: "Patient flagged acutely unwell/fasting — hold the SGLT2 inhibitor now." });
      if (egfr != null && egfr < 30)
        warnings.push({ severity: "caution", message: "Low eGFR — glucose-lowering effect is reduced; follow the product's eGFR limits." });
      warnings.push({ severity: "info", message: "Counsel on genital/urinary infection and volume depletion." });
      if (pregnant) warnings.push({ severity: "contraindicated", message: "Avoid in pregnancy — switch to insulin." });
      break;
    case "insulin":
      warnings.push({ severity: "info", message: "Main risk is hypoglycaemia — needs reliable glucose logging and hypo education. Never stop insulin in type 1 diabetes, even when not eating (sick-day rules)." });
      break;
    case "dpp4":
      warnings.push({ severity: "info", message: "Generally well tolerated; adjust dose in renal impairment per the specific agent (linagliptin needs no adjustment)." });
      break;
    case "ace_arb":
      if (pregnant)
        warnings.push({ severity: "contraindicated", message: "ACE inhibitors / ARBs are contraindicated in pregnancy — stop and switch (teratogenic)." });
      warnings.push({ severity: "info", message: "Kidney-protective in diabetes; check U&E and potassium after starting or increasing the dose." });
      break;
  }
  return warnings;
}
