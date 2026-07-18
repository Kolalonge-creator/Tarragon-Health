import { z } from "zod";

/**
 * A single knowledge-check question stored in
 * `health_education_content.knowledge_check` (jsonb). The stored shape is
 * untrusted (admin/seed authored), so the feed hands us `Json` and we parse it
 * here before rendering — a malformed row degrades to "no check" rather than
 * throwing in the patient's dashboard.
 */
export const knowledgeCheckQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  answer_index: z.number().int().nonnegative(),
});
export type KnowledgeCheckQuestion = z.infer<typeof knowledgeCheckQuestionSchema>;

export const knowledgeCheckSchema = z
  .array(knowledgeCheckQuestionSchema)
  .min(1)
  // Drop questions whose answer_index points outside their own options — a
  // corrupt row should never mark a correct answer wrong (or vice-versa).
  .transform((questions) => questions.filter((q) => q.answer_index < q.options.length));

/** Parse the raw jsonb into typed questions, or null if it isn't a usable check. */
export function parseKnowledgeCheck(raw: unknown): KnowledgeCheckQuestion[] | null {
  const result = knowledgeCheckSchema.safeParse(raw);
  if (!result.success || result.data.length === 0) return null;
  return result.data;
}

export interface KnowledgeCheckResult {
  score: number;
  total: number;
  allCorrect: boolean;
}

/**
 * Pure scoring — engagement telemetry only, NEVER a clinical assessment. The
 * result decides which `health_education_status` a progress row gets
 * (all-correct → `understood`, otherwise → `needs_review`) and nothing else;
 * it never touches risk scoring or escalation. `answers` is the selected option
 * index per question (undefined = unanswered = wrong).
 */
export function scoreKnowledgeCheck(
  questions: KnowledgeCheckQuestion[],
  answers: ReadonlyArray<number | undefined>
): KnowledgeCheckResult {
  const total = questions.length;
  const score = questions.reduce(
    (acc, q, i) => (answers[i] === q.answer_index ? acc + 1 : acc),
    0
  );
  return { score, total, allCorrect: total > 0 && score === total };
}

/** The progress status implied by a completed check. */
export function statusFromCheck(result: KnowledgeCheckResult) {
  return result.allCorrect ? ("understood" as const) : ("needs_review" as const);
}
