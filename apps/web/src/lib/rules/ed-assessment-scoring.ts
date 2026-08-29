/**
 * Erectile dysfunction self-assessment scoring (Men's Health §45.5).
 *
 * Pure — no DB access — mirroring mental-health-screening.ts's shape: a
 * published, standard instrument, scored deterministically, unit-testable on
 * both client (live preview) and server (source of truth).
 *
 *   IIEF-5 (Sexual Health Inventory for Men) — 5 items, each 1–5, total 5–25.
 *   V1 simplification (same discipline as risk-scoring.ts's own docblock):
 *   the clinical IIEF-5 allows a 0 ("no sexual activity/attempts") response
 *   on items 2–5; this simplified digital version always asks for a 1–5
 *   answer so the total stays in a fixed, always-valid range. A patient with
 *   no recent sexual activity is directed to skip the assessment entirely
 *   rather than answer with a 0.
 *
 * A score is triage telemetry for the care team, never a diagnosis — the
 * workflow's own "clinical consultation" and "underlying risk assessment"
 * steps are a doctor's job, not this function's.
 */

export const IIEF5_ITEM_COUNT = 5;

export type EdSeverityBand = "severe" | "moderate" | "mild_moderate" | "mild" | "none";

export interface EdAssessmentResult {
  total: number;
  band: EdSeverityBand;
  /**
   * Erectile dysfunction can be an early signal of cardiovascular/metabolic
   * disease (CLAUDE.md §45.5's core clinical-safety point) — flagged
   * whenever any degree of ED is reported, not only at the severe end, so a
   * younger man with mild ED still gets the coexistence check.
   */
  cardiometabolicReviewSuggested: boolean;
}

export function scoreEdAssessment(items: number[]): EdAssessmentResult {
  if (items.length !== IIEF5_ITEM_COUNT) {
    throw new Error(`IIEF-5 expects ${IIEF5_ITEM_COUNT} items, got ${items.length}`);
  }
  for (const value of items) {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error("IIEF-5 items must be integers 1–5");
    }
  }
  const total = items.reduce((sum, value) => sum + value, 0);

  let band: EdSeverityBand;
  if (total >= 22) band = "none";
  else if (total >= 17) band = "mild";
  else if (total >= 12) band = "mild_moderate";
  else if (total >= 8) band = "moderate";
  else band = "severe";

  return { total, band, cardiometabolicReviewSuggested: band !== "none" };
}

export const ED_SEVERITY_BAND_LABEL: Record<EdSeverityBand, string> = {
  none: "No significant erectile difficulty",
  mild: "Mild",
  mild_moderate: "Mild to moderate",
  moderate: "Moderate",
  severe: "Severe",
};
