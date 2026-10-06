/**
 * Word error rate for the scribe's speech-to-text, so it can be MEASURED on local, consented audio before the scribe is
 * switched on (spec: no live use of a language until its error rate is known). Pure: no I/O, no clock.
 *
 * WER = (substitutions + deletions + insertions) / reference words. It is computed on normalised text: lower case,
 * punctuation removed, digits kept, whitespace collapsed. Two things are reported next to the rate because a rate
 * alone hides what matters clinically:
 *   - negation drops: a reference "not" / "no" / "never" / "without" / "nothing" / "none" the transcript lost (a dropped
 *     "not" is one word and reverses a symptom), and
 *   - protected terms missed: drug names, doses and numbers the clinician lists for that sample.
 */

const NEGATIONS = new Set(["not", "no", "never", "without", "nothing", "none", "dont", "doesnt", "didnt", "cant", "wont", "isnt", "arent", "nobody", "neva"]);

export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface EditCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
}

/** Word-level edit distance with the three edit kinds counted. */
export function editCounts(reference: string[], hypothesis: string[]): EditCounts {
  const n = reference.length;
  const m = hypothesis.length;
  // dp[i][j] = [cost, subs, dels, ins]
  let prev: [number, number, number, number][] = Array.from({ length: m + 1 }, (_, j) => [j, 0, 0, j]);
  for (let i = 1; i <= n; i++) {
    const cur: [number, number, number, number][] = [[i, 0, i, 0]];
    for (let j = 1; j <= m; j++) {
      if (reference[i - 1] === hypothesis[j - 1]) {
        cur[j] = prev[j - 1] as [number, number, number, number];
      } else {
        const sub = prev[j - 1] as [number, number, number, number];
        const del = prev[j] as [number, number, number, number];
        const ins = cur[j - 1] as [number, number, number, number];
        const best = Math.min(sub[0], del[0], ins[0]);
        if (best === sub[0]) cur[j] = [sub[0] + 1, sub[1] + 1, sub[2], sub[3]];
        else if (best === del[0]) cur[j] = [del[0] + 1, del[1], del[2] + 1, del[3]];
        else cur[j] = [ins[0] + 1, ins[1], ins[2], ins[3] + 1];
      }
    }
    prev = cur;
  }
  const end = prev[m] as [number, number, number, number];
  return { substitutions: end[1], deletions: end[2], insertions: end[3] };
}

export interface SampleResult {
  id: string;
  language: string;
  referenceWords: number;
  edits: EditCounts;
  wer: number;
  negationsInReference: number;
  negationsDropped: number;
  protectedTerms: number;
  protectedTermsMissed: string[];
}

/** Multiset difference count: how many of `wanted` words are not matched in `have`. */
function missing(wanted: string[], have: string[]): string[] {
  const pool = new Map<string, number>();
  for (const w of have) pool.set(w, (pool.get(w) ?? 0) + 1);
  const out: string[] = [];
  for (const w of wanted) {
    const c = pool.get(w) ?? 0;
    if (c > 0) pool.set(w, c - 1);
    else out.push(w);
  }
  return out;
}

export function scoreSample(input: {
  id: string;
  language: string;
  reference: string;
  hypothesis: string;
  protectedTerms?: string[];
}): SampleResult {
  const ref = normalise(input.reference);
  const hyp = normalise(input.hypothesis);
  const edits = editCounts(ref, hyp);
  const refNeg = ref.filter((w) => NEGATIONS.has(w));
  const droppedNeg = missing(refNeg, hyp.filter((w) => NEGATIONS.has(w)));
  const terms = (input.protectedTerms ?? []).flatMap((term) => normalise(term).length > 0 ? [normalise(term).join(" ")] : []);
  const hypJoined = ` ${hyp.join(" ")} `;
  const termsMissed = terms.filter((term) => !hypJoined.includes(` ${term} `));
  const errors = edits.substitutions + edits.deletions + edits.insertions;
  return {
    id: input.id,
    language: input.language,
    referenceWords: ref.length,
    edits,
    wer: ref.length === 0 ? (hyp.length === 0 ? 0 : 1) : errors / ref.length,
    negationsInReference: refNeg.length,
    negationsDropped: droppedNeg.length,
    protectedTerms: terms.length,
    protectedTermsMissed: termsMissed,
  };
}

export interface LanguageReport {
  language: string;
  samples: number;
  referenceWords: number;
  wer: number;
  negationsInReference: number;
  negationsDropped: number;
  protectedTerms: number;
  protectedTermsMissed: number;
}

/** Corpus-level WER per language: total errors over total reference words (not the mean of sample rates). */
export function reportByLanguage(results: SampleResult[]): LanguageReport[] {
  const by = new Map<string, SampleResult[]>();
  for (const r of results) by.set(r.language, [...(by.get(r.language) ?? []), r]);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, rows]) => {
      const words = rows.reduce((s, r) => s + r.referenceWords, 0);
      const errors = rows.reduce((s, r) => s + r.edits.substitutions + r.edits.deletions + r.edits.insertions, 0);
      return {
        language,
        samples: rows.length,
        referenceWords: words,
        wer: words === 0 ? 0 : errors / words,
        negationsInReference: rows.reduce((s, r) => s + r.negationsInReference, 0),
        negationsDropped: rows.reduce((s, r) => s + r.negationsDropped, 0),
        protectedTerms: rows.reduce((s, r) => s + r.protectedTerms, 0),
        protectedTermsMissed: rows.reduce((s, r) => s + r.protectedTermsMissed.length, 0),
      };
    });
}
