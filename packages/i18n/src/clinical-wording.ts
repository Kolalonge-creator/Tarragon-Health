import WORDING from "./clinical-wording.json";

/**
 * The words for the emergency and triage messages (OQ-203): ONE source for the screen text, the audio script and the
 * manifest. The draft (`proposed`) is not used until the CMO has signed it; until then the app keeps saying `current`,
 * which is what it said before. Setting `signed` is a clinical sign-off and is never done by a build.
 */
export type WordingCode = keyof typeof WORDING.codes;

export interface Sign {
  readonly by: string;
  readonly on: string;
  readonly version: number;
}

export const WORDING_SIGNED: Sign | null = WORDING.signed as Sign | null;

export const WORDING_CODES = Object.keys(WORDING.codes) as WordingCode[];

/** The words in force for a code: the signed proposal, otherwise today's text. */
export function activeWording(code: WordingCode, signed: Sign | null = WORDING_SIGNED): { title: string; body: string } {
  const w = WORDING.codes[code];
  return signed ? w.proposed : w.current;
}

/** What a voice says for on-screen words: digits written out, nothing else changed. */
export function speakable(text: string): string {
  return Object.entries(WORDING.spoken).reduce((t, [written, said]) => t.replace(written, said), text);
}

export const WORDING_KEYS: Readonly<Record<WordingCode, string>> = Object.fromEntries(
  Object.entries(WORDING.codes).map(([code, w]) => [code, w.key]),
) as Record<WordingCode, string>;
