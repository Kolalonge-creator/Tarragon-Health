/**
 * Validated mental-health screen scoring (AHC pathway §11; Module 46 §46.3).
 *
 * Pure — no DB access — so it is unit-testable and can be re-run on the client
 * for a live preview and on the server as the source of truth. These are
 * standard, published instruments:
 *   - PHQ-9  depression   9 items, each 0–3, total 0–27; item 9 is the
 *            self-harm question — any non-zero answer is a crisis red flag
 *            routed to the emergency pathway (AHC §11 / §18.2).
 *   - GAD-7  anxiety      7 items, each 0–3, total 0–21.
 *   - AUDIT-C alcohol     3 items, each 0–4, total 0–12; the hazardous-use
 *            cut-off is sex-specific (men ≥4, women ≥3).
 *   - EPDS   postnatal    10 items, each 0–3, total 0–30 (§46.3 "postnatal
 *            mental health"); offered alongside, never instead of, PHQ-9/
 *            GAD-7/AUDIT-C when a patient self-identifies as pregnant or
 *            within 12 months postpartum. Item 10 is the self-harm question —
 *            same crisis convention as PHQ-9 item 9.
 *
 * A screen score is engagement/triage telemetry for the doctor — never a
 * diagnosis. It is never used to adjust a chronic-disease risk score, but a
 * moderate/high-concern band (or a crisis flag) does route to a clinician for
 * review (private.classify_mental_health_screen_concern, §46.5) — a score is
 * never actioned beyond that by software alone.
 */

export type MentalHealthInstrument = "phq9" | "gad7" | "auditc" | "epds";

export const PHQ9_ITEM_COUNT = 9;
export const GAD7_ITEM_COUNT = 7;
export const AUDITC_ITEM_COUNT = 3;

export type Phq9Band = "minimal" | "mild" | "moderate" | "moderately_severe" | "severe";
export type Gad7Band = "minimal" | "mild" | "moderate" | "severe";
export type AuditCBand = "low_risk" | "increasing_risk" | "higher_risk";

function assertItems(items: number[], count: number, max: number, label: string): void {
  if (items.length !== count) {
    throw new Error(`${label} expects ${count} items, got ${items.length}`);
  }
  for (const value of items) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(`${label} items must be integers 0–${max}`);
    }
  }
}

function sum(items: number[]): number {
  return items.reduce((total, value) => total + value, 0);
}

export interface Phq9Result {
  instrument: "phq9";
  total: number;
  band: Phq9Band;
  /** PHQ-9 item 9 (self-harm) answered > 0 — routes to the emergency pathway. */
  crisis: boolean;
}

export function scorePhq9(items: number[]): Phq9Result {
  assertItems(items, PHQ9_ITEM_COUNT, 3, "PHQ-9");
  const total = sum(items);
  let band: Phq9Band;
  if (total <= 4) band = "minimal";
  else if (total <= 9) band = "mild";
  else if (total <= 14) band = "moderate";
  else if (total <= 19) band = "moderately_severe";
  else band = "severe";
  return { instrument: "phq9", total, band, crisis: items[PHQ9_ITEM_COUNT - 1] > 0 };
}

export interface Gad7Result {
  instrument: "gad7";
  total: number;
  band: Gad7Band;
}

export function scoreGad7(items: number[]): Gad7Result {
  assertItems(items, GAD7_ITEM_COUNT, 3, "GAD-7");
  const total = sum(items);
  let band: Gad7Band;
  if (total <= 4) band = "minimal";
  else if (total <= 9) band = "mild";
  else if (total <= 14) band = "moderate";
  else band = "severe";
  return { instrument: "gad7", total, band };
}

export interface AuditCResult {
  instrument: "auditc";
  total: number;
  band: AuditCBand;
  /** At or above the sex-specific hazardous-drinking cut-off. */
  hazardous: boolean;
}

/** AUDIT-C hazardous cut-off: men ≥4, women ≥3. Unknown sex uses the more
 * cautious ≥3 so a real concern is never missed on a blank demographic. */
export function scoreAuditC(items: number[], sex: "male" | "female" | null): AuditCResult {
  assertItems(items, AUDITC_ITEM_COUNT, 4, "AUDIT-C");
  const total = sum(items);
  const cutoff = sex === "male" ? 4 : 3;
  let band: AuditCBand;
  if (total < cutoff) band = "low_risk";
  else if (total <= 7) band = "increasing_risk";
  else band = "higher_risk";
  return { instrument: "auditc", total, band, hazardous: total >= cutoff };
}

export const PHQ9_BAND_LABEL: Record<Phq9Band, string> = {
  minimal: "Minimal",
  mild: "Mild",
  moderate: "Moderate",
  moderately_severe: "Moderately severe",
  severe: "Severe",
};

export const GAD7_BAND_LABEL: Record<Gad7Band, string> = {
  minimal: "Minimal",
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

export const AUDITC_BAND_LABEL: Record<AuditCBand, string> = {
  low_risk: "Lower risk",
  increasing_risk: "Increasing risk",
  higher_risk: "Higher risk",
};

export const EPDS_ITEM_COUNT = 10;

export type EpdsBand = "minimal" | "mild" | "moderate" | "severe";

export interface EpdsResult {
  instrument: "epds";
  total: number;
  band: EpdsBand;
  /** EPDS item 10 (self-harm) answered > 0 — routes to the emergency pathway,
   * same convention as PHQ-9 item 9. */
  crisis: boolean;
}

/** Standard published EPDS cut-offs (0–9 minimal, 10–12 mild, 13–19 moderate,
 * 20+ severe) — same "use the published instrument directly" precedent as
 * PHQ-9/GAD-7/AUDIT-C above. */
export function scoreEpds(items: number[]): EpdsResult {
  assertItems(items, EPDS_ITEM_COUNT, 3, "EPDS");
  const total = sum(items);
  let band: EpdsBand;
  if (total <= 9) band = "minimal";
  else if (total <= 12) band = "mild";
  else if (total <= 19) band = "moderate";
  else band = "severe";
  return { instrument: "epds", total, band, crisis: items[EPDS_ITEM_COUNT - 1] > 0 };
}

export const EPDS_BAND_LABEL: Record<EpdsBand, string> = {
  minimal: "Minimal",
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};
