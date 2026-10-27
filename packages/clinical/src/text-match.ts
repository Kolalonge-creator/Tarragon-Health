/**
 * Word-boundary text matching for the S89 copilot checks. Pure and deterministic: no model, no I/O, no clock.
 *
 * Matching is by whole tokens, never by substring, so "archive" does not hit "hiv" and "bicycle" does not hit "cycle". Text is lowercased
 * and stripped of diacritics, then split on anything that is not a letter or digit, so "PHQ-9", "phq 9" and "Phq9" are comparable.
 * A term is one or more words ("hepatitis b", "gad-7"); a trailing `*` makes the last word a prefix ("pregnan*" matches pregnant,
 * pregnancy). Nothing clinical lives here: every term list is passed in from versioned PROPOSED config.
 */

/** Lowercase, strip diacritics, and turn every run of non-alphanumerics into one space. */
export function normaliseText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenise(s: string): string[] {
  const n = normaliseText(s);
  return n === "" ? [] : n.split(" ");
}

/** Spelling aliases (for example sulpha to sulfa) applied token by token, to both sides of a comparison. */
export function applyAliases(tokens: readonly string[], aliases: Readonly<Record<string, string>> = {}): string[] {
  // A plural of an aliased word ("sulphonamides") maps like the singular, keeping its "s" so the plural rule below still applies.
  return tokens.map((t) => aliases[t] ?? (t.endsWith("s") && aliases[t.slice(0, -1)] !== undefined ? `${aliases[t.slice(0, -1)]}s` : t));
}

interface ParsedTerm {
  words: string[];
  prefixLast: boolean;
}

function parseTerm(term: string, aliases: Readonly<Record<string, string>>): ParsedTerm | null {
  const prefixLast = term.trim().endsWith("*");
  const words = applyAliases(tokenise(term), aliases);
  if (words.length === 0) return null;
  return { words, prefixLast };
}

/** Edit distance, stopping early once it is certain to exceed `max`. */
export function editDistanceAtMost(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] as number;
}

/** Words this long or longer may differ by one edit (a typo) and still count as the same word. */
export const FUZZY_MIN_LENGTH = 6;

export interface MatchOptions {
  aliases?: Readonly<Record<string, string>>;
  /** Allow one typo in single words of FUZZY_MIN_LENGTH or more. Off for sensitive-category matching, on for allergy matching. */
  fuzzy?: boolean;
}

function wordEquals(token: string, word: string, prefix: boolean, fuzzy: boolean): boolean {
  if (prefix) return token.startsWith(word);
  if (token === word) return true;
  // A plain plural ("penicillins") is the same word.
  if (word.length >= 4 && (token === `${word}s` || token === `${word}es`)) return true;
  return fuzzy && word.length >= FUZZY_MIN_LENGTH && token.length >= FUZZY_MIN_LENGTH && editDistanceAtMost(token, word, 1) <= 1;
}

/** True when the term's words appear as a contiguous run of whole tokens in `tokens`. Empty terms never match. */
export function tokensMatchTerm(tokens: readonly string[], term: string, options: MatchOptions = {}): boolean {
  const parsed = parseTerm(term, options.aliases ?? {});
  if (!parsed) return false;
  const { words, prefixLast } = parsed;
  const fuzzy = options.fuzzy === true;
  outer: for (let i = 0; i + words.length <= tokens.length; i++) {
    for (let k = 0; k < words.length; k++) {
      const last = k === words.length - 1;
      if (!wordEquals(tokens[i + k] as string, words[k] as string, last && prefixLast, fuzzy)) continue outer;
    }
    return true;
  }
  return false;
}

/** Whole-token match of `term` anywhere in `text`. */
export function textMatchesTerm(text: string, term: string, options: MatchOptions = {}): boolean {
  return tokensMatchTerm(applyAliases(tokenise(text), options.aliases ?? {}), term, options);
}

export function textMatchesAny(text: string, terms: readonly string[], options: MatchOptions = {}): boolean {
  const tokens = applyAliases(tokenise(text), options.aliases ?? {});
  return terms.some((t) => tokensMatchTerm(tokens, t, options));
}
