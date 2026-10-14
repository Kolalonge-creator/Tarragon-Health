import WORDING from "./glucose-wording.json";
import type { Sign } from "./clinical-wording";

/**
 * The words for the glucose and ketone triage messages and the upper-arm cuff advice (plan item R2, CMO Q4 and Q6 to Q9). Same gate as
 * clinical-wording.ts, kept in its own file with its own `signed` (null) so that signing the blood pressure wording never signs these,
 * and the reverse. Unsigned means `current`. A build never sets `signed`: it is the Chief Medical Officer's act.
 */
export type GlucoseWordingCode = keyof typeof WORDING.codes;

export const GLUCOSE_WORDING_SIGNED: Sign | null = WORDING.signed as Sign | null;

export const GLUCOSE_WORDING_CODES = Object.keys(WORDING.codes) as GlucoseWordingCode[];

/** The words in force for a code: the signed proposal, otherwise the plain text that gives no treatment instruction. */
export function activeGlucoseWording(code: GlucoseWordingCode, signed: Sign | null = GLUCOSE_WORDING_SIGNED): { title: string; body: string } {
  const w = WORDING.codes[code];
  return signed ? w.proposed : w.current;
}

export const GLUCOSE_WORDING_KEYS: Readonly<Record<GlucoseWordingCode, string>> = Object.fromEntries(
  Object.entries(WORDING.codes).map(([code, w]) => [code, w.key]),
) as Record<GlucoseWordingCode, string>;

export const GLUCOSE_WORDING_DATA = WORDING;
