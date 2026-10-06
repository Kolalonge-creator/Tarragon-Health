/**
 * NUM stitching (spec 8.8): speak a person's own reading by joining short recorded clips on the phone, for
 * example `NUM-P01 + NUM-148 + NUM-P02 + NUM-094`. Nothing leaves the phone, and it works offline.
 *
 * Pure. A stitcher returns null when it cannot say the value exactly with the clips that exist (a number out
 * of range, a fraction the kit has no clip for). The caller then shows the text only: never a guess, never a
 * rounded number the patient did not log.
 */
export interface PhraseStep {
  readonly id: string;
  /** The digits (or the decimal point) this step stands for in the shown text. Absent for a recorded sentence part. */
  readonly literal?: string;
  /** Join to the previous step with no space ("7" "." "2" reads "7.2"). */
  readonly tight?: boolean;
}

export interface Phrase {
  readonly steps: readonly PhraseStep[];
}

export const MAX_WHOLE = 600;
const MIN_ROUNDED_STEPS = 1000;
const MAX_ROUNDED_STEPS = 20000;

export const numClipId = (n: number): string => `NUM-${String(n).padStart(3, "0")}`;
const phrasePart = (id: string): PhraseStep => ({ id });

const isWhole = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= MAX_WHOLE;

function wholeSteps(n: number): PhraseStep[] {
  return [{ id: numClipId(n), literal: String(n) }];
}

/** One decimal place, as meters and lab reports show it: 7.2 is "seven point two", 7.0 is just "seven". */
function decimalSteps(value: number): PhraseStep[] | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const tenths = Math.round(value * 10);
  const whole = Math.floor(tenths / 10);
  const digit = tenths % 10;
  if (!isWhole(whole)) return null;
  if (digit === 0) return wholeSteps(whole);
  return [...wholeSteps(whole), { id: "NUM-D01", literal: ".", tight: true }, { id: numClipId(digit), literal: String(digit), tight: true }];
}

const build = (...groups: (readonly PhraseStep[] | null)[]): Phrase | null => (groups.some((g) => g === null) ? null : { steps: groups.flat() as PhraseStep[] });

export function stitchBloodPressure(systolic: number, diastolic: number): Phrase | null {
  if (!isWhole(systolic) || !isWhole(diastolic)) return null;
  return build([phrasePart("NUM-P01")], wholeSteps(systolic), [phrasePart("NUM-P02")], wholeSteps(diastolic));
}

export type GlucoseUnit = "mg/dl" | "mmol/l";

export function stitchGlucose(value: number, unit: GlucoseUnit): Phrase | null {
  const number = unit === "mg/dl" ? (isWhole(value) ? wholeSteps(value) : null) : decimalSteps(value);
  return build([phrasePart("NUM-P03")], number, [phrasePart(unit === "mg/dl" ? "NUM-P04" : "NUM-P05")]);
}

export function stitchWeight(kg: number): Phrase | null {
  return build([phrasePart("NUM-P06")], decimalSteps(kg), [phrasePart("NUM-P07")]);
}

export function stitchPulse(bpm: number): Phrase | null {
  return isWhole(bpm) ? build([phrasePart("NUM-P08")], wholeSteps(bpm), [phrasePart("NUM-P09")]) : null;
}

export function stitchHbA1c(percent: number): Phrase | null {
  return build([phrasePart("NUM-P10")], decimalSteps(percent), [phrasePart("NUM-P11")]);
}

export type Comparison = "higher" | "lower" | "same";
const COMPARISON_CLIP: Record<Comparison, string> = { higher: "NUM-P13", lower: "NUM-P14", same: "NUM-P15" };

/** "Your average this week is 138 over 86. That is higher than last week." The comparison is optional. */
export function stitchWeeklyBloodPressureAverage(systolic: number, diastolic: number, comparison?: Comparison): Phrase | null {
  if (!isWhole(systolic) || !isWhole(diastolic)) return null;
  return build(
    [phrasePart("NUM-P12")],
    wholeSteps(systolic),
    [phrasePart("NUM-P02")],
    wholeSteps(diastolic),
    comparison ? [phrasePart(COMPARISON_CLIP[comparison])] : [],
  );
}

/** "This week you have taken 5 out of 7 doses." */
export function stitchAdherence(taken: number, total: number): Phrase | null {
  if (!isWhole(taken) || !isWhole(total) || taken > total) return null;
  return build([phrasePart("NUM-P16")], wholeSteps(taken), [phrasePart("NUM-P17")], wholeSteps(total), [phrasePart("NUM-P18")]);
}

/** "You have logged for 12 days in a row." */
export function stitchStreak(days: number): Phrase | null {
  return isWhole(days) ? build([phrasePart("NUM-P19")], wholeSteps(days), [phrasePart("NUM-P20")]) : null;
}

/**
 * "Today you have walked 2500 steps." Up to 600 is exact. From 1000 to 20000 the kit has a clip for every five
 * hundred, and the count is rounded to the NEAREST five hundred (the shown digits say the same number). Between 601
 * and 999, and above 20000, the kit has no clip, so there is no audio rather than a wrong number.
 */
export function stitchSteps(steps: number): Phrase | null {
  if (!Number.isFinite(steps) || steps < 0) return null;
  const n = Math.round(steps);
  let number: PhraseStep[] | null;
  if (n <= MAX_WHOLE) {
    number = wholeSteps(n);
  } else {
    const rounded = Math.round(n / 500) * 500;
    number = rounded >= MIN_ROUNDED_STEPS && rounded <= MAX_ROUNDED_STEPS ? [{ id: `NUM-S${rounded}`, literal: String(rounded) }] : null;
  }
  return build([phrasePart("NUM-P21")], number, [phrasePart("NUM-P23")]);
}
