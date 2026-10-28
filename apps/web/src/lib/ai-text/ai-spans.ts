/**
 * AI-inserted text, span by span (S89). Pure: no clock, no I/O, no model.
 *
 * A draft from a model is split into spans (sentences or lines). Each span starts "unreviewed" and stays that way until the clinician
 * edits it, removes it or explicitly accepts it. Signing is only possible when no span is unreviewed (and the clinician has attested).
 * The edit-rate figures are computed here, in the browser, from what the clinician did; the AI text itself is never sent anywhere by this
 * module and never reaches the patient record without the clinician's signature (INV-11).
 */

export type SpanStatus = "unreviewed" | "accepted" | "edited" | "removed";

export interface AiSpan {
  id: number;
  /** The text exactly as the model produced it. */
  original: string;
  /** The text as it stands now (equals `original` until edited). */
  text: string;
  status: SpanStatus;
  /**
   * The whitespace that came before this span in the model's text: "" for the first span, " " inside a line, "\n" or "\n\n" (plus any
   * indent) at a line or paragraph break. Kept so reassembled text keeps its line breaks and list layout.
   */
  sep: string;
}

/** Words that end in a full stop without ending a sentence. Text handling only: nothing here is a clinical list. */
export const SENTENCE_ABBREVIATIONS: ReadonlySet<string> = new Set([
  "dr", "mr", "mrs", "ms", "prof", "approx", "vs", "st", "jr", "sr", "fig", "ca", "cf", "dept", "est", "inc", "ltd", "re", "min", "max", "ref", "no", "nos", "vol", "etc",
]);

/** True when the full stop after `word` belongs to the word (an abbreviation, an initial, a list number or a dotted form like "e.g."). */
function stopBelongsToWord(word: string, isFirstWordOfLine: boolean): boolean {
  const w = word.toLowerCase().replace(/^[("'[]+/, "");
  if (SENTENCE_ABBREVIATIONS.has(w)) return true;
  if (/^[a-z]$/.test(w)) return true; // an initial: "J. Smith"
  if (isFirstWordOfLine && /^\d+$/.test(w)) return true; // a numbered list item: "1. Rest"
  if (/^[a-z](\.[a-z])+$/.test(w)) return true; // "e.g", "i.e", "b.i.d"
  return false;
}

/** Splits one line into sentences. A "!" or "?" ends a sentence; a "." does not when it belongs to an abbreviation or the next word is lowercase. */
function splitSentences(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /([.!?]+)(["')\]]*)(\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const stopEnd = m.index + m[1]!.length + m[2]!.length;
    const next = line.slice(stopEnd + m[3]!.length, stopEnd + m[3]!.length + 1);
    const before = line.slice(start, m.index);
    const word = before.split(/\s+/).pop() ?? "";
    const strong = /[!?]/.test(m[1]!);
    if (!strong) {
      if (next === "" || /[a-z]/.test(next)) continue;
      if (stopBelongsToWord(word, before.trim() === word)) continue;
    }
    out.push(line.slice(start, stopEnd));
    start = stopEnd + m[3]!.length;
  }
  if (start < line.length) out.push(line.slice(start));
  return out;
}

export function splitIntoSpans(text: string): AiSpan[] {
  const spans: AiSpan[] = [];
  const re = /(\n+)/;
  const parts = text.replace(/\r\n?/g, "\n").split(re);
  let pending = "";
  for (const part of parts) {
    if (/^\n+$/.test(part)) {
      pending += part;
      continue;
    }
    const indent = part.match(/^[ \t]*/)?.[0] ?? "";
    const sentences = splitSentences(part.trim()).map((x) => x.trim()).filter((x) => x.length > 0);
    sentences.forEach((sentence, i) => {
      const sep = spans.length === 0 ? "" : i === 0 ? (pending === "" ? " " : pending + indent) : " ";
      spans.push({ id: spans.length, original: sentence, text: sentence, status: "unreviewed", sep });
    });
    if (sentences.length > 0) pending = "";
  }
  return spans;
}

export function acceptSpan(spans: readonly AiSpan[], id: number): AiSpan[] {
  return spans.map((s) => (s.id === id && s.status === "unreviewed" ? { ...s, status: "accepted" } : s));
}

/** Replace a span's text. Empty text removes the span; text equal to the original counts as an explicit accept; anything else is an edit. */
export function editSpan(spans: readonly AiSpan[], id: number, newText: string): AiSpan[] {
  return spans.map((s) => {
    if (s.id !== id) return s;
    const t = newText.trim();
    if (t === "") return { ...s, text: "", status: "removed" };
    return { ...s, text: t, status: t === s.original ? "accepted" : "edited" };
  });
}

export const unreviewedCount = (spans: readonly AiSpan[]): number => spans.filter((s) => s.status === "unreviewed").length;
export const allReviewed = (spans: readonly AiSpan[]): boolean => unreviewedCount(spans) === 0;

/** Spans that will be part of the signed text: not removed and not empty. */
export const liveSpans = (spans: readonly AiSpan[]): AiSpan[] => spans.filter((s) => s.status !== "removed" && s.text.trim() !== "");

/**
 * A fingerprint of every span (its id, status and text, and how many there are). An attestation is bound to the fingerprint it was
 * given for: any later change to any span, or any span added, makes the fingerprint differ and the attestation lapses.
 */
export function spansFingerprint(spans: readonly AiSpan[]): string {
  return JSON.stringify(spans.map((s) => [s.id, s.status, s.text]));
}

/** True only when the attestation was given for exactly these spans. */
export const attestationHolds = (attestedFor: string | null, spans: readonly AiSpan[]): boolean =>
  attestedFor !== null && attestedFor === spansFingerprint(spans);

/**
 * Sign is possible only when at least one non-empty span remains (an emptied draft has nothing to sign), every span has been reviewed
 * and the clinician has attested to these exact spans.
 */
export function canSign(spans: readonly AiSpan[], attested: boolean): boolean {
  return liveSpans(spans).length > 0 && allReviewed(spans) && attested;
}

/** The text as it stands, removed spans left out, line breaks and list layout kept. A paragraph break before a removed span is not lost. */
export function assembleText(spans: readonly AiSpan[]): string {
  const richer = (a: string, b: string): string => ((b.match(/\n/g)?.length ?? 0) >= (a.match(/\n/g)?.length ?? 0) ? b : a);
  let out = "";
  let carried = "";
  let first = true;
  for (const s of spans) {
    carried = first && out === "" ? carried : richer(carried, s.sep);
    if (s.status === "removed" || s.text.trim() === "") continue;
    out += first ? s.text : `${carried || " "}${s.text}`;
    first = false;
    carried = "";
  }
  return out;
}

/** Words for comparison: trailing punctuation is ignored, so adding a full stop is not an edit. */
const words = (t: string): string[] => t.split(/\s+/).map((w) => w.replace(/[.,;:!?]+$/, "")).filter((w) => w.length > 0);

/** Longest common subsequence length of two word lists. */
function lcs(a: readonly string[], b: readonly string[]): number {
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(up, prev[j - 1] as number);
      diag = up;
    }
  }
  return prev[b.length] as number;
}

/** Words of `original` that no longer appear (in order) in `final`, plus words added that were not in the original: a word-level change count. */
export function changedWordCount(original: string, final: string): number {
  const o = words(original);
  const f = words(final);
  const common = lcs(o, f);
  return o.length - common + (f.length - common);
}

export interface EditTelemetry {
  /** Words the model produced. */
  aiWords: number;
  /** Word-level changes the clinician made (deleted or added). */
  changedWords: number;
  /** changedWords / aiWords, capped at 1. Null ("n/a") when the model returned nothing: a rate of 0 would read as "left untouched". */
  editRate: number | null;
  /** True when every AI word was kept exactly as produced and nothing was added: the rubber-stamping alarm figure. */
  leftUnedited: boolean;
}

export function editTelemetryFromPairs(pairs: readonly { original: string; final: string }[]): EditTelemetry {
  const aiWords = pairs.reduce((n, p) => n + words(p.original).length, 0);
  const changedWords = pairs.reduce((n, p) => n + changedWordCount(p.original, p.final), 0);
  return {
    aiWords,
    changedWords,
    editRate: aiWords === 0 ? null : Math.min(1, changedWords / aiWords),
    leftUnedited: aiWords > 0 && changedWords === 0,
  };
}

export function editTelemetryFromSpans(spans: readonly AiSpan[]): EditTelemetry {
  return editTelemetryFromPairs(spans.map((s) => ({ original: s.original, final: s.status === "removed" ? "" : s.text })));
}

/** The edit rate for display: a percentage, or "n/a" when there was no AI text to edit. */
export function formatEditRate(t: Pick<EditTelemetry, "editRate">): string {
  return t.editRate === null ? "n/a" : `${Math.round(t.editRate * 100)}%`;
}
