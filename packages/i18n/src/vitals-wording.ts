import WORDING from "./vitals-wording.json";
import type { Sign } from "./clinical-wording";

/**
 * The words for the pulse, SpO2 and temperature triage messages (the single-reading vitals rule set). Same gate as
 * glucose-wording.ts, kept in its own file with its own `signed` (null) so that signing the blood pressure or glucose wording never signs these,
 * and the reverse. Unsigned means `current`. A build never sets `signed`: it is the Chief Medical Officer's act.
 */
export type VitalsWordingCode = keyof typeof WORDING.codes;

export const VITALS_WORDING_SIGNED: Sign | null = WORDING.signed as Sign | null;

export const VITALS_WORDING_CODES = Object.keys(WORDING.codes) as VitalsWordingCode[];

/** The words in force for a code: the signed proposal, otherwise the plain text that gives no treatment instruction. */
export function activeVitalsWording(code: VitalsWordingCode, signed: Sign | null = VITALS_WORDING_SIGNED): { title: string; body: string } {
  const w = WORDING.codes[code];
  return signed ? w.proposed : w.current;
}

export const VITALS_WORDING_KEYS: Readonly<Record<VitalsWordingCode, string>> = Object.fromEntries(
  Object.entries(WORDING.codes).map(([code, w]) => [code, w.key]),
) as Record<VitalsWordingCode, string>;

export const VITALS_WORDING_DATA = WORDING;
