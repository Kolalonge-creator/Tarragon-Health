/**
 * Which sentences of an AI draft are supported by the visit text (S76-S80). Pure and deterministic: string and term overlap only, no model,
 * no extra LLM call. A model is never asked whether a sentence is supported.
 *
 * A sentence is "supported" when enough of its content words, and every number in it, appear in the visit text. Otherwise it is marked
 * "not said in the visit" and the clinician must keep it on purpose or remove it. The best-matching line of the visit text is returned so
 * the review screen can show the evidence next to the sentence. A sentence with too few content words (stock phrases) is not judged.
 */
import { getProposedConfig } from "@tarragon/shared";

export type Support = "supported" | "unsupported" | "neutral";

export interface SentenceSupport {
  text: string;
  support: Support;
  /** Index into the visit lines of the best-matching line, or null when nothing matched. */
  sourceLine: number | null;
  /** Share of this sentence's content words found in the visit text (0-1). */
  overlap: number;
}

const STOP = new Set(
  (
    "a an the and or but if then so of to in on at by for with from as is are was were be been being am do does did done has have had having " +
    "it its this that these those there here he she they them his her their we you your our i me my not no yes also very more most some any " +
    "will would can could should may might must about into over under again further than too just which who whom what when where why how " +
    "patient reports reported states stated discussed noted note advised plan today"
  ).split(" "),
);

function rules(): { support_min_overlap: number; min_content_terms: number } {
  return getProposedConfig<{ support_min_overlap: number; min_content_terms: number }>("scribe.review_rules").value;
}

/** Light stemming so "headaches" matches "headache" and "vomiting" matches "vomited". */
export function stem(word: string): string {
  let w = word;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w.length > 7 ? w.slice(0, 7) : w;
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:[./][0-9]+)?/g) ?? []).filter(Boolean);
}

function contentTerms(text: string): string[] {
  return tokens(text)
    .filter((t) => /^[0-9]/.test(t) || (!STOP.has(t) && t.length > 2))
    .map((t) => (/^[0-9]/.test(t) ? t : stem(t)));
}

/** Splits on sentence ends and line breaks; keeps the text of each sentence trimmed. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** The visit text as lines, the unit the review screen shows and links to. */
export function visitLines(source: string): string[] {
  return source
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

export function matchSentences(draftText: string, source: string): SentenceSupport[] {
  const { support_min_overlap: minOverlap, min_content_terms: minTerms } = rules();
  const lines = visitLines(source);
  const lineTerms = lines.map((l) => new Set(contentTerms(l)));
  const all = new Set<string>();
  for (const s of lineTerms) for (const t of s) all.add(t);

  return splitSentences(draftText).map((sentence): SentenceSupport => {
    const terms = [...new Set(contentTerms(sentence))];
    if (terms.length < minTerms) return { text: sentence, support: "neutral", sourceLine: null, overlap: 1 };
    const found = terms.filter((t) => all.has(t));
    const overlap = found.length / terms.length;
    const numbers = terms.filter((t) => /^[0-9]/.test(t));
    const numbersOk = numbers.every((n) => all.has(n));
    let best = -1;
    let bestCount = 0;
    lineTerms.forEach((set, i) => {
      const c = terms.filter((t) => set.has(t)).length;
      if (c > bestCount) {
        bestCount = c;
        best = i;
      }
    });
    const supported = overlap >= minOverlap && numbersOk;
    return { text: sentence, support: supported ? "supported" : "unsupported", sourceLine: best >= 0 ? best : null, overlap };
  });
}

/** Normalised key so a clinician's "I checked this" survives re-rendering but not an edit to the sentence. */
export function sentenceKey(sentence: string): string {
  return sentence.toLowerCase().replace(/\s+/g, " ").trim();
}

export function unsupportedSentences(draftText: string, source: string): SentenceSupport[] {
  return matchSentences(draftText, source).filter((s) => s.support === "unsupported");
}
