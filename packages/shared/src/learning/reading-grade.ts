/**
 * Reading-grade gate for patient content (S55 quality gates, item 12a).
 *
 * A transparent, deterministic readability score: the Flesch-Kincaid grade level,
 *     grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
 * rounded to one decimal and never below 0. No model, no network.
 *
 * THE DATABASE REPEATS THIS EXACTLY (private.reading_grade in the quality-gates migration) so the publish gate cannot be talked round
 * by a client that reports its own grade. The two are held together by golden vectors: READING_GRADE_VECTORS below is asserted by the
 * Jest test here AND by the database proof (reading_grade_gate.sql). Change one and the other fails.
 *
 * Definitions (kept deliberately simple so a reviewer can check them by hand):
 *  - Markdown marks (# * _ ` > |) are treated as spaces.
 *  - A word is a run of letters, with an inner apostrophe counted as part of the word ("don't" is one word). Numbers are not words.
 *  - A sentence is a stretch of text that contains at least one letter and ends at . ! ? or a line break.
 *  - Syllables per word use the common vowel-group estimate. It is an estimate, not a dictionary, and it can be a little off for
 *    unusual words. It is the same estimate in both places, which is what the gate needs.
 *
 * The maximum grade is PROPOSED configuration (`learning.reading_grade`, owner CMO), never a constant in this file.
 */
export interface ReadingGradeConfig {
  /** Highest Flesch-Kincaid grade a piece of patient content may have when it is published. */
  readonly max_grade: number;
  /** Shortest reason an override must give. */
  readonly min_override_reason_chars: number;
}

export interface ReadingGradeResult {
  readonly grade: number;
  readonly words: number;
  readonly sentences: number;
  readonly syllables: number;
}

/** Syllables in one word (any non-letters are ignored). */
export function countSyllables(rawWord: string): number {
  let word = rawWord.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length === 0) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  word = word.replace(/^y/, "");
  const groups = word.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export function readingGrade(text: string): ReadingGradeResult {
  const cleaned = text.toLowerCase().replace(/[#*_`>|]/g, " ");
  const words = cleaned.match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const sentences = cleaned.split(/[.!?]+|\n+/).filter((s) => /[a-z]/.test(s)).length;
  if (words.length === 0 || sentences === 0) return { grade: 0, words: words.length, sentences, syllables: 0 };
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const raw = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
  const grade = Math.max(0, Math.round(raw * 10) / 10);
  return { grade, words: words.length, sentences, syllables };
}

export type ReadingGradeVerdict =
  | { readonly ok: true; readonly grade: number; readonly overridden: boolean }
  | { readonly ok: false; readonly grade: number; readonly reason: "too_hard" | "override_reason_too_short" };

/**
 * The same decision the database makes at publish time, for the editor to show before the button is pressed.
 * An override is accepted only with a written reason of at least `min_override_reason_chars` characters.
 */
export function checkReadingGrade(grade: number, config: ReadingGradeConfig, overrideReason?: string | null): ReadingGradeVerdict {
  if (grade <= config.max_grade) return { ok: true, grade, overridden: false };
  const reason = (overrideReason ?? "").trim();
  if (reason.length === 0) return { ok: false, grade, reason: "too_hard" };
  if (reason.length < config.min_override_reason_chars) return { ok: false, grade, reason: "override_reason_too_short" };
  return { ok: true, grade, overridden: true };
}

/**
 * Golden vectors shared with the database proof (which carries the same literals). No text sits near a rounding boundary, so the
 * database's exact decimal arithmetic and this file's floating point round the same way.
 */
export const READING_GRADE_VECTORS: ReadonlyArray<{ readonly name: string; readonly text: string; readonly grade: number }> = [
  { name: "plain", text: "Take your tablet each morning. Sit and rest for five minutes. Then check your blood pressure.", grade: 1.2 },
  { name: "dense", text: "Hypertension is a chronic cardiovascular condition characterised by persistently elevated arterial pressure.", grade: 21.5 },
  {
    name: "markdown_lines_apostrophe",
    text: "## Salt\n- Eat less salt\n- Use **fresh** pepper, not seasoning cubes\nIt is easy to start. Don't worry if you slip.",
    grade: 0.7,
  },
  { name: "empty", text: "", grade: 0 },
];
