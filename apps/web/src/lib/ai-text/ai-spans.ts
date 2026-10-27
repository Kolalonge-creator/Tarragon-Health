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
}

export function splitIntoSpans(text: string): AiSpan[] {
  const pieces = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return pieces.map((p, id) => ({ id, original: p, text: p, status: "unreviewed" as const }));
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

/** Sign is possible only when every span has been reviewed and the clinician has attested. An empty draft has nothing to sign. */
export function canSign(spans: readonly AiSpan[], attested: boolean): boolean {
  return spans.length > 0 && allReviewed(spans) && attested;
}

export function assembleText(spans: readonly AiSpan[]): string {
  return spans.filter((s) => s.status !== "removed").map((s) => s.text).join(" ");
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
  /** changedWords / aiWords, capped at 1; 0 when there was no AI text. */
  editRate: number;
  /** True when every AI word was kept exactly as produced and nothing was added: the rubber-stamping alarm figure. */
  leftUnedited: boolean;
}

export function editTelemetryFromPairs(pairs: readonly { original: string; final: string }[]): EditTelemetry {
  const aiWords = pairs.reduce((n, p) => n + words(p.original).length, 0);
  const changedWords = pairs.reduce((n, p) => n + changedWordCount(p.original, p.final), 0);
  return {
    aiWords,
    changedWords,
    editRate: aiWords === 0 ? 0 : Math.min(1, changedWords / aiWords),
    leftUnedited: aiWords > 0 && changedWords === 0,
  };
}

export function editTelemetryFromSpans(spans: readonly AiSpan[]): EditTelemetry {
  return editTelemetryFromPairs(spans.map((s) => ({ original: s.original, final: s.status === "removed" ? "" : s.text })));
}
