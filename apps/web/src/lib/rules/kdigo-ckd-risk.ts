import type { Enums } from "@tarragon/shared";
import type { GfrCategory } from "./egfr";

/**
 * KDIGO 2012 CKD risk categorisation — combines the GFR category (from
 * egfr.ts) with the albuminuria category (from a urine ACR) into KDIGO's
 * published risk "heat map". The two markers move risk independently: a
 * normal-or-mildly-reduced eGFR with heavy albuminuria is a real, elevated-
 * risk case that eGFR alone never surfaces, and today nothing on this
 * platform computes that combination even though both values are already
 * captured (`lab_analyte_readings` codes `creatinine` and `urine_acr`).
 *
 * Source: KDIGO 2012 Clinical Practice Guideline for the Evaluation and
 * Management of Chronic Kidney Disease, Kidney Int Suppl. 2013;3(1):1-150,
 * Figure 4 (the GFR x albuminuria prognosis grid). Reproduced identically in
 * every major CKD guideline since (e.g. NICE NG203), so the grid itself is
 * treated as a settled clinical reference, not a single-source figure.
 */

export type AcrCategory = "A1" | "A2" | "A3";

export const ACR_CATEGORY_LABEL: Record<AcrCategory, string> = {
  A1: "Normal to mildly increased (<30 mg/g)",
  A2: "Moderately increased (30–300 mg/g)",
  A3: "Severely increased (>300 mg/g)",
};

/** A1/A2/A3 per KDIGO, using mg/g — the catalogue's canonical unit for `urine_acr`. */
export function acrCategory(acrMgG: number): AcrCategory {
  if (acrMgG < 30) return "A1";
  if (acrMgG <= 300) return "A2";
  return "A3";
}

const HEAT_MAP: Record<GfrCategory, Record<AcrCategory, Enums<"risk_level">>> = {
  G1: { A1: "low", A2: "moderate", A3: "high" },
  G2: { A1: "low", A2: "moderate", A3: "high" },
  G3a: { A1: "moderate", A2: "high", A3: "very_high" },
  G3b: { A1: "high", A2: "very_high", A3: "very_high" },
  G4: { A1: "very_high", A2: "very_high", A3: "very_high" },
  G5: { A1: "very_high", A2: "very_high", A3: "very_high" },
};

export interface KdigoRiskInput {
  gfrCategory: GfrCategory;
  /** Urine albumin-to-creatinine ratio, mg/g. */
  acrMgG: number;
}

export interface KdigoRiskResult {
  acrCategory: AcrCategory;
  acrCategoryLabel: string;
  riskLevel: Enums<"risk_level">;
  /** True when the GFR category alone (G1/G2 — "normal or high") would have looked reassuring. */
  invisibleToEgfrAlone: boolean;
}

/**
 * Combine a GFR category with an ACR reading into the KDIGO risk grid. Pure
 * function — returns null only for a non-finite/negative ACR, same
 * honest-null convention as the rest of this rules directory (see egfr.ts).
 */
export function combineKdigoRisk(input: KdigoRiskInput): KdigoRiskResult | null {
  if (!Number.isFinite(input.acrMgG) || input.acrMgG < 0) return null;

  const acr = acrCategory(input.acrMgG);
  const riskLevel = HEAT_MAP[input.gfrCategory][acr];
  const invisibleToEgfrAlone =
    (input.gfrCategory === "G1" || input.gfrCategory === "G2") && acr !== "A1";

  return {
    acrCategory: acr,
    acrCategoryLabel: ACR_CATEGORY_LABEL[acr],
    riskLevel,
    invisibleToEgfrAlone,
  };
}
