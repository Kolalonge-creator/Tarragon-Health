/**
 * The stored edit diff for an AI scribe draft (S76-S80). Pure: no I/O, no clock.
 *
 * When a clinician signs, we keep the AI's text and a computed word-level diff against the signed text, so the Chief Medical Officer can
 * see how much of each draft was rewritten. The diff is a list of operations over words: `eq` runs are stored as a count only (the text is
 * recoverable from the two full texts), `del` and `ins` carry the words. A section too long to compare word by word is stored as one
 * replacement. This only measures; it decides nothing clinical (INV-11 still holds: the draft was never in the record until signed).
 */
import { getProposedConfig } from "@tarragon/shared";
import { DRAFT_SECTION_KEYS, type DraftFields, type DraftSectionKey } from "./draft-review";

export type DiffOp = { op: "eq"; n: number } | { op: "del"; text: string } | { op: "ins"; text: string };

export interface SectionDiff {
  draft_words: number;
  signed_words: number;
  words_added: number;
  words_removed: number;
  ops: DiffOp[];
}
export type SignedDiff = Record<DraftSectionKey, SectionDiff>;

function words(text: string): string[] {
  const t = text.trim();
  return t === "" ? [] : t.split(/\s+/);
}

function maxDiffWords(): number {
  return getProposedConfig<{ max_diff_words: number }>("scribe.review_rules").value.max_diff_words;
}

/** Word-level diff by longest common subsequence. Exported for tests. */
export function diffWords(before: string, after: string, limit: number = maxDiffWords()): SectionDiff {
  const a = words(before);
  const b = words(after);
  const base = { draft_words: a.length, signed_words: b.length };
  if (a.length === 0 && b.length === 0) return { ...base, words_added: 0, words_removed: 0, ops: [] };
  if (a.length > limit || b.length > limit) {
    // too long to compare word by word: one replacement, counted in full
    const ops: DiffOp[] = [];
    if (a.length) ops.push({ op: "del", text: a.join(" ") });
    if (b.length) ops.push({ op: "ins", text: b.join(" ") });
    return { ...base, words_added: b.length, words_removed: a.length, ops };
  }
  // lcs[i][j] = length of the common subsequence of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let removed = 0;
  let added = 0;
  const pushEq = () => {
    const last = ops[ops.length - 1];
    if (last?.op === "eq") last.n += 1;
    else ops.push({ op: "eq", n: 1 });
  };
  const pushChange = (op: "del" | "ins", word: string) => {
    const last = ops[ops.length - 1];
    if (last && last.op === op) last.text += ` ${word}`;
    else ops.push({ op, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      pushEq();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      pushChange("ins", b[j]);
      added++;
      j++;
    } else {
      pushChange("del", a[i]);
      removed++;
      i++;
    }
  }
  return { ...base, words_added: added, words_removed: removed, ops };
}

export function buildSignedDiff(original: DraftFields, signed: DraftFields): SignedDiff {
  const out = {} as SignedDiff;
  for (const key of DRAFT_SECTION_KEYS) out[key] = diffWords(original[key], signed[key]);
  return out;
}

/** True when the clinician changed anything in the section. */
export function sectionChanged(d: SectionDiff): boolean {
  return d.words_added > 0 || d.words_removed > 0;
}

/** Share of the AI draft's words that the clinician removed or replaced (0 when the draft was empty). Counts in, ratio out. */
export function editRate(totalDraftWords: number, totalWordsRemoved: number): number {
  return totalDraftWords === 0 ? 0 : Math.min(1, totalWordsRemoved / totalDraftWords);
}
