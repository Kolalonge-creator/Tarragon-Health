/**
 * Sexual dysfunction screen scoring (spec §47.10) — four short instruments,
 * each a faithful plain-language paraphrase of a standard clinical concept
 * (see lib/validation/sexual-health-screen.ts for the exact item wording),
 * scored deterministically here so a client can never post a spoofed total
 * or severity band.
 *
 * SCORING DIRECTION — this is the part that matters for correctness:
 *   - iief5 (erectile function) and libido_brief (low libido): every item is
 *     worded so a HIGHER raw answer means BETTER function / less concern.
 *     1-5 per item, total 5-25. The WORST end of the clinical spectrum
 *     ("severe") is therefore the LOW end of the raw total.
 *   - fsfi_pain (painful intercourse) and pe_diagnostic_tool (premature
 *     ejaculation): every item is worded so a HIGHER raw answer means WORSE
 *     symptoms. 0-5 per item, total 0-25. The worst end of the clinical
 *     spectrum is therefore the HIGH end of the raw total.
 * Both directions are normalised below to a single "distance from the best
 * possible outcome" before banding, so severe always means the same thing
 * (worst clinical end) regardless of which raw-score direction produced it.
 *
 * Bands follow the spec's "roughly top/bottom ~20%, two middle bands share
 * the rest" shape, applied as a percentage of the instrument's total point
 * range (not a percentage of the count of possible integer totals, which
 * doesn't divide evenly) — deterministic and exactly reproducible in tests.
 *
 * cardiometabolic_flag is set only for iief5 at moderate/severe — erectile
 * dysfunction has a well-established link to cardiovascular/metabolic risk;
 * the other three instruments never set it.
 */

export type SexualHealthInstrument = "iief5" | "fsfi_pain" | "libido_brief" | "pe_diagnostic_tool";
export type SexualHealthSeverityBand = "none_minimal" | "mild" | "moderate" | "severe";

export const SEXUAL_HEALTH_ITEM_COUNT = 5;

interface InstrumentShape {
  itemMin: number;
  itemMax: number;
  totalMin: number;
  totalMax: number;
  /** true when a higher total means better/less concern (iief5,
   * libido_brief); false when a higher total means worse symptoms
   * (fsfi_pain, pe_diagnostic_tool). */
  higherIsBetter: boolean;
}

const INSTRUMENT_SHAPE: Record<SexualHealthInstrument, InstrumentShape> = {
  iief5: { itemMin: 1, itemMax: 5, totalMin: 5, totalMax: 25, higherIsBetter: true },
  libido_brief: { itemMin: 1, itemMax: 5, totalMin: 5, totalMax: 25, higherIsBetter: true },
  fsfi_pain: { itemMin: 0, itemMax: 5, totalMin: 0, totalMax: 25, higherIsBetter: false },
  pe_diagnostic_tool: { itemMin: 0, itemMax: 5, totalMin: 0, totalMax: 25, higherIsBetter: false },
};

export interface SexualHealthScoreResult {
  totalScore: number;
  severityBand: SexualHealthSeverityBand;
  cardiometabolicFlag: boolean;
}

function assertItems(instrument: SexualHealthInstrument, items: number[]): void {
  const { itemMin, itemMax } = INSTRUMENT_SHAPE[instrument];
  if (items.length !== SEXUAL_HEALTH_ITEM_COUNT) {
    throw new Error(`${instrument} expects ${SEXUAL_HEALTH_ITEM_COUNT} items, got ${items.length}`);
  }
  for (const value of items) {
    if (!Number.isInteger(value) || value < itemMin || value > itemMax) {
      throw new Error(`${instrument} items must be integers ${itemMin}-${itemMax}`);
    }
  }
}

function bandForInstrument(
  instrument: SexualHealthInstrument,
  total: number
): SexualHealthSeverityBand {
  const { totalMin, totalMax, higherIsBetter } = INSTRUMENT_SHAPE[instrument];
  const range = totalMax - totalMin;
  // 0 = best possible outcome, range = worst possible outcome, regardless of
  // which raw direction the instrument uses.
  const distanceFromBest = higherIsBetter ? totalMax - total : total - totalMin;

  if (distanceFromBest <= range * 0.2) return "none_minimal";
  if (distanceFromBest <= range * 0.5) return "mild";
  if (distanceFromBest <= range * 0.8) return "moderate";
  return "severe";
}

export function scoreSexualHealthScreen(
  instrument: SexualHealthInstrument,
  items: number[]
): SexualHealthScoreResult {
  assertItems(instrument, items);
  const totalScore = items.reduce((sum, value) => sum + value, 0);
  const severityBand = bandForInstrument(instrument, totalScore);
  const cardiometabolicFlag =
    instrument === "iief5" && (severityBand === "moderate" || severityBand === "severe");
  return { totalScore, severityBand, cardiometabolicFlag };
}

export const SEXUAL_HEALTH_SEVERITY_BAND_LABEL: Record<SexualHealthSeverityBand, string> = {
  none_minimal: "Minimal or no concern",
  mild: "Mild",
  moderate: "Moderate",
  severe: "Significant",
};
