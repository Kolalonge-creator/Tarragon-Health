import { z } from "zod";

export const WRITTEN_QUESTION_CATEGORIES = ["medication", "symptom", "results", "lifestyle", "general"] as const;
export type WrittenQuestionCategory = (typeof WRITTEN_QUESTION_CATEGORIES)[number];

export const QUESTION_MIN_LENGTH = 10;
export const QUESTION_MAX_LENGTH = 2000;

const messageSchema = z.object({
  id: z.string(),
  author_role: z.enum(["patient", "care_team"]),
  body: z.string(),
  created_at: z.string(),
});

export const writtenQuestionSchema = z.object({
  id: z.string(),
  category: z.string(),
  question: z.string(),
  status: z.enum(["submitted", "in_review", "answered", "closed"]),
  answer: z.string().nullable(),
  answer_kind: z.enum(["guidance", "needs_more_information", "needs_call"]).nullable(),
  created_at: z.string(),
  answered_at: z.string().nullable(),
  window_due_at: z.string().nullable(),
  follow_up_until: z.string().nullable(),
  window_missed_at: z.string().nullable(),
  photos: z.number().nullable().optional(),
  messages: z.array(messageSchema).nullable().optional(),
});
export type WrittenQuestion = z.infer<typeof writtenQuestionSchema>;
export type WrittenQuestionMessage = z.infer<typeof messageSchema>;

export const allowanceSchema = z.object({
  is_member: z.boolean(),
  has_credit: z.boolean(),
  allowance: z.number(),
  used: z.number(),
  remaining: z.number(),
  window_minutes: z.number(),
  follow_up_days: z.number(),
  max_photos: z.number(),
  max_photo_bytes: z.number(),
});
export type WrittenQuestionAllowance = z.infer<typeof allowanceSchema>;

/** The RPC returns a JSON array, or null while empty; anything malformed is dropped rather than shown half-parsed. */
export function parseWrittenQuestions(raw: unknown): WrittenQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: WrittenQuestion[] = [];
  for (const item of raw) {
    const parsed = writtenQuestionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function parseAllowance(raw: unknown): WrittenQuestionAllowance | null {
  const parsed = allowanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
