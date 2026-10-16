/**
 * Reading a NAFDAC registration number off a medicine pack (spec 8.1, 8.8; S53 follow-up).
 *
 * Pure and offline. Two jobs only:
 *  1. turn something TYPED, or text a phone read off a photo, into a well-formed number the patient can confirm;
 *  2. look that number up in the medicine catalogue so the add form can be pre-filled.
 *
 * THIS IS NOT AN AUTHENTICITY CHECK. A number that is "in our catalogue" only means a pharmacist copied that number from
 * NAFDAC's register into our list. A counterfeit pack can print a real number. Whether a pack is genuine is NAFDAC's Mobile
 * Authentication Service to answer (NAFDAC_MAS in the phone app), so nothing here returns, and no caller may show, the words
 * genuine, fake, safe or approved. Everything extracted is a SUGGESTION: nothing is saved until the patient confirms each field.
 *
 * The number format is PROPOSED configuration (registry key `medicines.nafdac_number_format`); the constant below is mirrored
 * from it and a test fails if the two drift.
 */
import type { CatalogueEntry } from "./catalogue";

export interface NafdacNumberConfig {
  /** Anchored regex SOURCE for a canonical number: optional letter (never I or O: they are read as 1 and 0), one or two digits, a hyphen, three to six digits, optional letter. */
  readonly pattern: string;
  /** Longest block of text scanned, so a huge OCR result cannot stall the phone. */
  readonly maxTextLength: number;
}

export const NAFDAC_NUMBER_CONFIG: NafdacNumberConfig = {
  pattern: "^[A-HJ-NP-Z]?[0-9]{1,2}-[0-9]{3,6}[A-HJ-NP-Z]?$",
  maxTextLength: 6000,
};

const DASH = "\\u2010-\\u2015\\u2212-";
const DASHES = new RegExp(`[${DASH.replace(/-$/, "")}]`, "g");
const BODY = `[A-Z]?[0-9OIL]{1,2}\\s?[${DASH}]\\s?[0-9OIL]{3,6}[A-Z]?`;
const LABELLED = new RegExp(`nafdac[^A-Z0-9]*(?:reg[A-Z]*[^A-Z0-9]*)?(?:(?:no|number|num)\\b[^A-Z0-9]*)?(${BODY})`, "gi");
const LOOSE = new RegExp(`\\b${BODY}\\b`, "gi");

/** What a typed or read string became. `ocrCorrected` means a look-alike character was swapped, so the patient must look closely. */
export interface NafdacNumber {
  value: string;
  ocrCorrected: boolean;
}

const patternCache = new Map<string, RegExp>();
function patternFor(source: string): RegExp {
  let re = patternCache.get(source);
  if (!re) {
    re = new RegExp(source);
    patternCache.set(source, re);
  }
  return re;
}

const fixDigits = (s: string): string => s.replace(/O/g, "0").replace(/[IL]/g, "1");

/**
 * Canonical form of one candidate, or null when it is not shaped like a NAFDAC number. Accepts lower case, odd dashes, spaces
 * around the hyphen and a leading "NAFDAC Reg. No." label. Look-alike letters in DIGIT positions (O for 0, I or L for 1) are
 * fixed and flagged; a real leading letter (A4, B4) is left alone.
 */
export function normaliseNafdacNumber(raw: string, config: NafdacNumberConfig = NAFDAC_NUMBER_CONFIG): NafdacNumber | null {
  const cleaned = raw
    .slice(0, 64)
    .replace(/^\s*(?:nafdac)?\s*(?:reg(?:istration)?\.?)?\s*(?:no|number|num)?\s*[.:#]*\s*/i, "")
    .replace(DASHES, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
  const direct = patternFor(config.pattern);
  if (direct.test(cleaned)) return { value: cleaned, ocrCorrected: false };
  const parts = cleaned.split("-");
  if (parts.length !== 2) return null;
  const [prefix, tail] = parts as [string, string];
  // Look-alikes in digit positions are fixed. Prefer reading the whole prefix as digits ("IO" is 10, "O4" is 04); otherwise keep
  // a real leading letter (A4, B4) and fix only what follows it.
  const fixedTail = tail.replace(/^([0-9OIL]+)([A-Z]?)$/, (_m, digits: string, suffix: string) => fixDigits(digits) + suffix);
  const candidates = [`${fixDigits(prefix)}-${fixedTail}`, `${prefix.charAt(0)}${fixDigits(prefix.slice(1))}-${fixedTail}`];
  const hit = candidates.find((c) => direct.test(c));
  return hit ? { value: hit, ocrCorrected: true } : null;
}

export interface NafdacCandidate extends NafdacNumber {
  /** "labelled": found right after "NAFDAC Reg. No." on the pack. "unlabelled": shaped like a number but nothing names it. */
  source: "labelled" | "unlabelled";
}

/** A month-year such as 10-2027 is an expiry date, not a registration number; only a label can make it one. */
const NOT_A_REGISTRATION = /(?:batch|lot|b\.?\s?no|bn|mfg|mfd|exp|expiry|date)(?:[^A-Z0-9]*(?:no|number|num))?[^A-Z0-9]*$/i;
const MONTH_YEAR = /^(0[1-9]|1[0-2])-(19|20)[0-9]{2}$/;

/**
 * Every plausible NAFDAC number in the lines a phone read from a pack, labelled ones first. These are suggestions to confirm.
 * An unlabelled number that could be a date is dropped.
 */
export function extractNafdacNumbers(lines: readonly string[], config: NafdacNumberConfig = NAFDAC_NUMBER_CONFIG): NafdacCandidate[] {
  const text = lines.join(" \n ").slice(0, config.maxTextLength);
  const out: NafdacCandidate[] = [];
  const add = (raw: string, source: NafdacCandidate["source"]) => {
    const n = normaliseNafdacNumber(raw, config);
    if (!n || out.some((o) => o.value === n.value)) return;
    // Only a labelled number is repaired or trusted to look like a date; an unlabelled guess must be clean.
    if (source === "unlabelled" && (n.ocrCorrected || MONTH_YEAR.test(n.value))) return;
    out.push({ ...n, source });
  };
  for (const m of text.matchAll(LABELLED)) add(m[1] as string, "labelled");
  for (const m of text.matchAll(LOOSE)) {
    // A batch, lot or date number is not a registration number.
    if (NOT_A_REGISTRATION.test(text.slice(Math.max(0, m.index - 16), m.index))) continue;
    add(m[0], "unlabelled");
  }
  return out;
}

const AMOUNT = "[0-9]+(?:[.,][0-9]+)*";
const STRENGTH = new RegExp(`\\b(${AMOUNT})\\s?(mg|mcg|µg|ug|g|ml|iu)(?![A-Za-z])(?:\\s?/\\s?(${AMOUNT})?\\s?(ml|mg|g)(?![A-Za-z]))?`, "i");

/** "1,000" is a thousand (a comma followed by exactly three digits); any other comma is a decimal point ("2,5"). */
const amount = (raw: string): string => (/^[0-9]{1,3}(?:,[0-9]{3})+$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", "."));

const unit = (u: string): string => {
  const l = u.toLowerCase();
  if (l === "ug" || l === "µg") return "mcg";
  return l === "iu" ? "IU" : l;
};

/** The first strength printed on the pack in a standard shape ("500 mg", "250 mg/5 ml"), or null. A suggestion only. */
export function extractStrengthSuggestion(lines: readonly string[], config: NafdacNumberConfig = NAFDAC_NUMBER_CONFIG): string | null {
  const m = STRENGTH.exec(lines.join(" \n ").slice(0, config.maxTextLength));
  if (!m) return null;
  const base = `${amount(m[1] as string)} ${unit(m[2] as string)}`;
  if (!m[4]) return base;
  return `${base}/${m[3] ? `${amount(m[3])} ` : ""}${unit(m[4])}`;
}

/**
 * Catalogue medicines whose brand or generic name is printed in the pack text (every word of the name present). Matching a KNOWN
 * name is safer than guessing which words on a box are the name. Names shorter than four letters are ignored so a short name
 * cannot match by accident.
 */
export function matchCatalogueNamesInText(
  lines: readonly string[],
  catalogue: readonly CatalogueEntry[],
  config: NafdacNumberConfig = NAFDAC_NUMBER_CONFIG,
  limit = 3,
): CatalogueEntry[] {
  const words = new Set(lines.join(" ").slice(0, config.maxTextLength).split(/[^A-Za-z0-9]+/).map((w) => w.toUpperCase()));
  const printed = (name: string | null): boolean => {
    if (!name || name.replace(/[^A-Za-z0-9]/g, "").length < 4) return false;
    return name.split(/[^A-Za-z0-9]+/).filter(Boolean).every((p) => words.has(p.toUpperCase()));
  };
  const seen = new Set<string>();
  return catalogue
    .filter((e) => printed(e.brandName) || printed(e.genericName))
    .filter((e) => (seen.has(e.genericName) ? false : (seen.add(e.genericName), true)))
    .slice(0, limit);
}

export type NafdacLookup =
  | { kind: "in_catalogue"; entries: CatalogueEntry[]; prefill: { drugName: string | null; strength: string | null; brandName: string | null } }
  | { kind: "not_matched" }
  | { kind: "invalid" };

const squash = (s: string): string => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * Look a typed or confirmed number up in the catalogue. Only a VERIFIED row counts (a pharmacist checked it against NAFDAC's
 * register); an unreviewed row with the same number is "not matched" and never pre-fills anything. A match is NOT proof the pack
 * is genuine. With an empty catalogue (offline, nothing cached) the answer is "not matched" and adding a medicine is unaffected.
 * When several rows share a number the name is pre-filled only if they agree, and strength and brand only when there is one row.
 */
export function lookupNafdacNumber(raw: string, catalogue: readonly CatalogueEntry[], config: NafdacNumberConfig = NAFDAC_NUMBER_CONFIG): NafdacLookup {
  const n = normaliseNafdacNumber(raw, config);
  if (!n) return { kind: "invalid" };
  const key = squash(n.value);
  const entries = catalogue.filter((e) => e.isVerified && e.nafdacNumber !== null && squash(e.nafdacNumber) === key);
  const first = entries[0];
  if (!first) return { kind: "not_matched" };
  const single = entries.length === 1;
  return {
    kind: "in_catalogue",
    entries,
    prefill: {
      drugName: entries.every((e) => e.genericName === first.genericName) ? first.genericName : null,
      strength: single ? first.strength : null,
      brandName: single ? first.brandName : null,
    },
  };
}
