/**
 * What the clinician confirmed but the draft does not say. Pure: no clock, no I/O, no model.
 *
 * Why it exists: published error studies of AI notes (docs/research/S35.md) find omissions the dominant error, and a
 * fluent note hides them. facts.ts `groundingWarnings` already checks the other direction (draft text with no fact
 * behind it). Nothing checked that every confirmed fact reached the draft, so a dropped negation, allergy or red flag
 * produced a clean-looking note. This closes that, deterministically: a language model is never asked whether
 * something was omitted (the same rule as facts.ts).
 *
 * It reads the draft text only, so it needs no change to the mirrored facts.ts or the edge function, and it keeps
 * working after the clinician edits a section. It is a lexical check, so it can flag a fact the draft paraphrased
 * ("Covered" is one click); it must never pass a fact the draft dropped or reversed. Where those two pull apart it
 * errs towards flagging, and only safety facts block "Use in note".
 */

import type { FactType, ScribeFact } from "./facts";

/** Negations, allergies and red flags: an omission here is a patient-safety problem, so it blocks use until resolved. */
export const SAFETY_FACT_TYPES: readonly FactType[] = ["negated_symptom", "allergy", "red_flag"];

/**
 * Medication facts are not checked: the draft is told never to name a medicine or dose (INV-02) and writes "Medication plan
 * discussed with the clinician" instead, so their absence from the text is correct, not an omission.
 */
const NOT_CHECKED: readonly FactType[] = ["medication_mentioned"];

const NEGATION_CUES = new Set(["no", "not", "nil", "denies", "denied", "deny", "without", "absent", "negative", "never", "none", "neither", "nor"]);

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "has", "have", "had", "was", "were", "been", "are", "his", "her", "their", "she", "him",
  "from", "into", "over", "per", "any", "but", "also", "patient", "reports", "reported", "states", "stated", "says", "said", "mentions",
  "mentioned", "history", "of", "is", "to", "in", "on", "at", "a", "an", "it", "its", "by", "as", "or",
]);

/** Crude suffix stripping, enough to match "headache"/"headaches" and "vomiting"/"vomited". Applied to both sides. */
function stem(word: string): string {
  // "allergic", "allergy" and "allergies" are the same word for this check; an allergy must not be flagged for the wording.
  if (word.startsWith("allerg")) return "allerg";
  let w = word;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:[.,][0-9]+)?/g) ?? []).map((w) => w.replace(",", "."));
}

/** The words that carry the fact's meaning: no stopwords, no negation cues (polarity is checked separately), no 1-2 letter words unless numbers. */
function contentTokens(text: string): string[] {
  const out = new Set<string>();
  for (const w of words(text)) {
    if (NEGATION_CUES.has(w) || STOPWORDS.has(w)) continue;
    if (w.length < 3 && !/\d/.test(w)) continue;
    out.add(/\d/.test(w) ? w : stem(w));
  }
  return [...out];
}

function sentences(text: string): string[] {
  return text.split(/[.!?;\n]+/).map((s) => s.trim()).filter(Boolean);
}

const COVERAGE = 0.6;

function coverage(tokens: readonly string[], haystack: ReadonlySet<string>): number {
  if (tokens.length === 0) return 1;
  return tokens.filter((t) => haystack.has(t)).length / tokens.length;
}

function tokenSet(text: string): Set<string> {
  const s = new Set<string>();
  for (const w of words(text)) s.add(/\d/.test(w) ? w : stem(w));
  return s;
}

/** Is this fact said in the draft? A negated symptom must also be said as a negation, in the same sentence as its words. */
export function isFactInDraft(fact: Pick<ScribeFact, "type" | "text">, draftText: string): boolean {
  const tokens = contentTokens(fact.text);
  if (tokens.length === 0) return true; // nothing checkable in the fact's own words; do not invent an omission
  const whole = tokenSet(draftText);
  if (coverage(tokens, whole) < COVERAGE) return false;
  if (fact.type !== "negated_symptom") return true;
  // "no chest pain" is only kept by a sentence that says the symptom AND a negation. "Reports chest pain" reverses it.
  return sentences(draftText).some((s) => {
    const inSentence = tokenSet(s);
    return words(s).some((w) => NEGATION_CUES.has(w)) && coverage(tokens, inSentence) >= COVERAGE;
  });
}

export interface Omission {
  readonly fact: ScribeFact;
  /** A safety omission blocks "Use in note" until the clinician adds it or says it was left out on purpose. */
  readonly safety: boolean;
}

/** Confirmed facts the draft text does not say, safety facts first, then in the order the clinician confirmed them. */
export function findOmissions(facts: readonly ScribeFact[], draftText: string): Omission[] {
  const out: Omission[] = [];
  for (const fact of facts) {
    if (NOT_CHECKED.includes(fact.type)) continue;
    if (isFactInDraft(fact, draftText)) continue;
    out.push({ fact, safety: SAFETY_FACT_TYPES.includes(fact.type) });
  }
  return out.sort((a, b) => Number(b.safety) - Number(a.safety));
}

/** Omissions still needing a decision: not now said in the text, and not marked "left out on purpose". */
export function unresolvedOmissions(omissions: readonly Omission[], leftOut: Readonly<Record<string, true>>): Omission[] {
  return omissions.filter((o) => !leftOut[o.fact.id]);
}

/** True when a safety omission is still open: the only omission state that blocks use. */
export function blocksUse(omissions: readonly Omission[], leftOut: Readonly<Record<string, true>>): boolean {
  return unresolvedOmissions(omissions, leftOut).some((o) => o.safety);
}

export type NoteSection = "history" | "examination" | "assessment" | "plan" | "followUp";

/** Where a fact belongs when the clinician chooses to add it back. */
export function defaultSectionFor(type: FactType): NoteSection {
  switch (type) {
    case "measurement_or_finding":
      return "examination";
    case "plan_item":
      return "plan";
    case "follow_up_item":
    case "red_flag":
      return "followUp";
    default:
      return "history";
  }
}
