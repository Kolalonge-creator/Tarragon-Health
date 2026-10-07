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

/**
 * S85 D2 / OQ-12: the words every screen that shows the fertile window (or a temperature-based ovulation confirmation)
 * must carry. Same gate as above, separate record: `fertileWindow.signed` is null until the CMO signs, and a build never
 * sets it. `current` and `proposed` are the same founder-mandated text on purpose. A missing label is the unsafe state, so
 * the label renders correctly whether or not the CMO has signed.
 */
export interface FertileWindowWords {
  readonly label: string;
  readonly link: string;
}

export const FERTILE_WINDOW_SIGNED: Sign | null = WORDING.fertileWindow.signed as Sign | null;

/** The words in force: the signed proposal, otherwise the interim text (identical today). */
export function activeFertileWindowWording(signed: Sign | null = FERTILE_WINDOW_SIGNED): FertileWindowWords {
  return signed ? WORDING.fertileWindow.proposed : WORDING.fertileWindow.current;
}

/** What every surface renders. Never a literal in a component: import this so no screen can drift. */
export const FERTILE_WINDOW_LABEL: string = activeFertileWindowWording().label;
export const FERTILE_WINDOW_LINK_TEXT: string = activeFertileWindowWording().link;

/** The three phrases the founder banned from the app (D2). Used by tests and by anything that builds copy near the window. */
export const FERTILE_WINDOW_BANNED_PHRASES = ["safe days", "avoid pregnancy", "natural contraception"] as const;
