/**
 * What the clinician did with each section of an AI draft, for the review record (S35c). Pure: no I/O.
 *
 * The record stores a per-section outcome and a hash of the draft as generated, never the draft text itself: the AI output
 * stays off the patient record until the note is signed (INV-11).
 *
 *   unchanged   the signed text contains the draft text as generated (anything the clinician added around it does not count as a change)
 *   edited      the draft had text and the final text is different
 *   emptied     the draft had text and the clinician removed all of it
 *   added       the draft was empty and the clinician wrote something
 *   empty_kept  the draft was empty and still is (flagged as a possible omission, confirmed as "nothing was discussed")
 */
import { DRAFT_SECTION_KEYS, type DraftFields, type DraftSectionKey } from "./draft-review";

export type SectionState = "unchanged" | "edited" | "emptied" | "added" | "empty_kept";
export type SectionOutcome = { state: SectionState; flagged_empty: boolean };
export type SectionOutcomes = Record<DraftSectionKey, SectionOutcome>;

function normalised(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function sectionState(original: string, final: string): SectionState {
  const o = normalised(original);
  const f = normalised(final);
  if (o === "" && f === "") return "empty_kept";
  if (o === "") return "added";
  if (f === "") return "emptied";
  return f.includes(o) ? "unchanged" : "edited";
}

export function sectionOutcomes(original: DraftFields, final: DraftFields): SectionOutcomes {
  const out = {} as SectionOutcomes;
  for (const key of DRAFT_SECTION_KEYS) {
    out[key] = { state: sectionState(original[key], final[key]), flagged_empty: normalised(original[key]) === "" };
  }
  return out;
}

/** Stable text for hashing: fixed key order, the draft exactly as generated. */
export function canonicalDraft(original: DraftFields): string {
  return JSON.stringify(DRAFT_SECTION_KEYS.map((key) => [key, original[key]]));
}

export async function draftHash(original: DraftFields, subtle: Pick<SubtleCrypto, "digest"> = globalThis.crypto.subtle): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalDraft(original));
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
