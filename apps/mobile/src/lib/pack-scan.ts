import {
  extractNafdacNumbers,
  extractStrengthSuggestion,
  lookupNafdacNumber,
  matchCatalogueNamesInText,
  type CatalogueEntry,
  type NafdacCandidate,
  type NafdacLookup,
} from "@tarragon/medicines";

/**
 * "Scan the pack" on the phone (spec 8.1, 8.8): read the NAFDAC number, strength and name off a photographed pack as SUGGESTIONS.
 *
 * Rules this file keeps:
 *  - Nothing read from a photo is a medicine on the person's list. The add form only changes when the person taps "Use this" on a
 *    single suggestion (`applyPackSuggestion`); the original photo is deleted as soon as it has been read and is never uploaded.
 *  - Reading needs on-device text recognition, which this build does not carry (it is a native module: OQ-NAFDAC-SCAN-2). Until
 *    one is registered, `packScanAvailable()` is false and the form shows only the typed NAFDAC number, which always works,
 *    offline too.
 *  - Neither this file nor the lookup says a pack is genuine. Authenticity stays NAFDAC's text service (NAFDAC_MAS).
 */

/** What a native text-recognition module must offer. Registered by the native build; none ships today. */
export interface PackTextReader {
  /** The lines of printed text found in the photo. May throw. */
  recognise(photoUri: string): Promise<string[]>;
}

let reader: PackTextReader | null = null;

export function registerPackTextReader(next: PackTextReader | null): void {
  reader = next;
}

/** Capability detection: true only when a text reader is registered. The Scan button is hidden otherwise. */
export function packScanAvailable(): boolean {
  return reader !== null;
}

export interface PackSuggestions {
  nafdacNumbers: NafdacCandidate[];
  strength: string | null;
  /** Catalogue medicines whose name is printed on the pack. */
  names: CatalogueEntry[];
}

export type PackScanOutcome =
  | { kind: "unavailable" }
  | { kind: "failed" }
  | { kind: "nothing_read" }
  | { kind: "suggestions"; suggestions: PackSuggestions };

export interface PackScanDeps {
  /** Deletes the photo file. Best effort; defaults to removing the picker's cache file. */
  discardPhoto?: (uri: string) => Promise<void>;
}

async function defaultDiscard(uri: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("expo-file-system") as typeof import("expo-file-system");
    const file = new fs.File(uri);
    if (file.exists) file.delete();
  } catch {
    // a photo that cannot be deleted stays in the system cache, which the OS clears; it is never uploaded
  }
}

/** Pure part: suggestions from already-read text lines. */
export function suggestionsFromText(lines: readonly string[], catalogue: readonly CatalogueEntry[]): PackSuggestions {
  return {
    nafdacNumbers: extractNafdacNumbers(lines),
    strength: extractStrengthSuggestion(lines),
    names: matchCatalogueNamesInText(lines, catalogue),
  };
}

/** Read one photo. Never throws, never uploads, always deletes the photo afterwards. */
export async function scanPackPhoto(photoUri: string, catalogue: readonly CatalogueEntry[], deps: PackScanDeps = {}): Promise<PackScanOutcome> {
  const discard = deps.discardPhoto ?? defaultDiscard;
  const active = reader;
  if (!active) {
    await discard(photoUri).catch(() => undefined);
    return { kind: "unavailable" };
  }
  try {
    const lines = await active.recognise(photoUri);
    const suggestions = suggestionsFromText(lines, catalogue);
    const any = suggestions.nafdacNumbers.length > 0 || suggestions.strength !== null || suggestions.names.length > 0;
    return any ? { kind: "suggestions", suggestions } : { kind: "nothing_read" };
  } catch {
    return { kind: "failed" };
  } finally {
    await discard(photoUri).catch(() => undefined);
  }
}

/** The add form's fields that a pack can suggest. */
export interface PackFormFields {
  drugName: string;
  dose: string;
  nafdacNumber: string;
}

export type PackSuggestionChoice =
  | { field: "nafdacNumber"; value: string }
  | { field: "dose"; value: string }
  | { field: "drugName"; value: string };

/**
 * The ONLY way a suggestion reaches the form: one field, on the person's tap. Returns a new object; a suggestion that is never
 * applied (or is dismissed) leaves the form exactly as it was.
 */
export function applyPackSuggestion(form: PackFormFields, choice: PackSuggestionChoice): PackFormFields {
  return { ...form, [choice.field]: choice.value };
}

/** Pre-fill from a catalogue match on the typed number: name and strength, when the catalogue has them. Applied on one tap. */
export function applyCatalogueLookup(form: PackFormFields, lookup: NafdacLookup): PackFormFields {
  if (lookup.kind !== "in_catalogue") return form;
  // The person tapped to replace what is there. A strength typed for a DIFFERENT medicine is not kept next to the new name.
  const drugName = lookup.prefill.drugName ?? form.drugName;
  const nameChanged = drugName.trim().toLowerCase() !== form.drugName.trim().toLowerCase();
  return { ...form, drugName, dose: lookup.prefill.strength ?? (nameChanged ? "" : form.dose) };
}

/** Which line to show under the typed number. Keys only; the screen turns them into words. */
export type NafdacLineKey = "packscan.nafdac.in_catalogue" | "packscan.nafdac.not_matched" | "packscan.nafdac.invalid" | null;

export function nafdacLineKey(typed: string, catalogue: readonly CatalogueEntry[]): NafdacLineKey {
  if (typed.trim().length === 0) return null;
  const lookup = lookupNafdacNumber(typed, catalogue);
  if (lookup.kind === "in_catalogue") return "packscan.nafdac.in_catalogue";
  return lookup.kind === "invalid" ? "packscan.nafdac.invalid" : "packscan.nafdac.not_matched";
}
