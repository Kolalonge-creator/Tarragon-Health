/**
 * Teach-back quiz at the end of a lesson (S55 quality gates, item 12c).
 *
 * One to three questions per lesson, written by the lesson's author. The point is to help the person check what they understood, not
 * to grade them:
 *  - a wrong answer shows the right one with the author's kind explanation;
 *  - the result is kept against the person's own account only; it is shown to the care team only if the person chooses to share it
 *    (through "ask your care team"), and nowhere else;
 *  - there are no public scores, streaks or "you lost" wording, and finishing the quiz never gates finishing the lesson.
 *
 * The limits (how many questions, how many options) are PROPOSED configuration (`learning.teachback`). The database holds the same
 * limits and marks the answers itself, so a client cannot store a result it did not earn.
 */
export interface TeachbackLimits {
  readonly min_questions: number;
  readonly max_questions: number;
  readonly min_options: number;
  readonly max_options: number;
}

export interface TeachbackQuestion {
  readonly question: string;
  readonly options: readonly string[];
  readonly answer_index: number;
  /** Shown when the answer was wrong (and gently confirmed when it was right). Written by the author. */
  readonly explanation: string;
}

export function parseTeachback(raw: unknown, limits: TeachbackLimits): TeachbackQuestion[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < limits.min_questions || raw.length > limits.max_questions) return null;
  const out: TeachbackQuestion[] = [];
  for (const q of raw as unknown[]) {
    if (typeof q !== "object" || q === null) return null;
    const r = q as Record<string, unknown>;
    const question = typeof r.question === "string" ? r.question.trim() : "";
    const explanation = typeof r.explanation === "string" ? r.explanation.trim() : "";
    const options = Array.isArray(r.options) ? (r.options as unknown[]) : [];
    const answer = r.answer_index;
    if (!question || !explanation) return null;
    if (options.length < limits.min_options || options.length > limits.max_options) return null;
    if (!options.every((o) => typeof o === "string" && o.trim().length > 0)) return null;
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    out.push({ question, options: (options as string[]).map((o) => o.trim()), answer_index: answer, explanation });
  }
  return out;
}

export interface TeachbackMark {
  readonly correct: boolean;
  readonly correctIndex: number;
  readonly explanation: string;
}

/** Marks the picked options. A missing or out-of-range pick is simply "not right yet", never an error. */
export function markTeachback(questions: readonly TeachbackQuestion[], picks: readonly (number | null)[]): TeachbackMark[] {
  return questions.map((q, i) => ({
    correct: picks[i] === q.answer_index,
    correctIndex: q.answer_index,
    explanation: q.explanation,
  }));
}
