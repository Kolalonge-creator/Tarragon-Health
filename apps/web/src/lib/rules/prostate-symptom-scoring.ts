/**
 * Prostate urinary symptom scoring + PSA-conversation prompt (Men's Health
 * §45.7). Pure — no DB access — same shape as mental-health-screening.ts.
 *
 *   IPSS (International Prostate Symptom Score) — 7 voiding/storage symptom
 *   items, each 0–5, total 0–35. (The instrument's separate QoL question is
 *   not scored here — a single free-standing question, not part of the
 *   0–35 total, and not needed for triage.)
 *
 * PSA testing is deliberately NOT recommended from the symptom score — BPH
 * symptoms and prostate cancer risk are different questions (see the
 * 'men-psa-test-explained' health-education article and the existing
 * shared-decision-making gate on the 'psa' screen_type,
 * packages: screening_cadence_and_psa_sdm_gate.sql). `psaConversationSuggested`
 * below only ever *prompts a conversation with the care team* — it never
 * orders or schedules a test, matching CLAUDE.md §45.7's guardrail against
 * presenting PSA testing as universally appropriate. The age/family-history
 * thresholds mirror the platform's own existing PSA screening age gate
 * (screen_types.age_from = 45 with recorded family history, else 50).
 */

export const IPSS_ITEM_COUNT = 7;

export type ProstateSymptomBand = "mild" | "moderate" | "severe";

export interface ProstateSymptomResult {
  total: number;
  band: ProstateSymptomBand;
}

export function scoreProstateSymptoms(items: number[]): ProstateSymptomResult {
  if (items.length !== IPSS_ITEM_COUNT) {
    throw new Error(`IPSS expects ${IPSS_ITEM_COUNT} items, got ${items.length}`);
  }
  for (const value of items) {
    if (!Number.isInteger(value) || value < 0 || value > 5) {
      throw new Error("IPSS items must be integers 0–5");
    }
  }
  const total = items.reduce((sum, value) => sum + value, 0);

  let band: ProstateSymptomBand;
  if (total <= 7) band = "mild";
  else if (total <= 19) band = "moderate";
  else band = "severe";

  return { total, band };
}

/**
 * A conversation-prompt only — never an auto-order. Matches the existing
 * platform PSA age gate: 45+ with a recorded family history of prostate
 * cancer, or 50+ regardless of family history.
 */
export function psaConversationSuggested(
  ageYears: number | null,
  familyHistoryProstateCancer: boolean
): boolean {
  if (ageYears === null) return false;
  return ageYears >= 50 || (ageYears >= 45 && familyHistoryProstateCancer);
}

export const PROSTATE_SYMPTOM_BAND_LABEL: Record<ProstateSymptomBand, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};
