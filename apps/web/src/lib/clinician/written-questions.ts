import { z } from "zod";

/**
 * Shared pieces for the clinician side of written questions (S22): input schemas, the plain-words error
 * mapping, and the narrow parsers for the JSON the database functions return. No server-only imports, so the
 * server actions, the page and the tests all read one definition.
 */

export const WRITTEN_QUESTION_READ_REASON = "Reading a written question I hold a claim on";
export const WRITTEN_QUESTION_PHOTO_READ_REASON = "Viewing a photo on a written question I hold a claim on";

export const ANSWER_KINDS = ["guidance", "needs_more_information", "needs_call"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

export const ANSWER_KIND_LABEL: Record<AnswerKind, string> = {
  guidance: "Guidance",
  needs_more_information: "I need more information",
  needs_call: "Needs a call",
};

export const HANDBACK_REASONS = [
  "conflict_of_interest",
  "outside_competence",
  "needs_information",
  "technical_problem",
  "other",
] as const;
export type HandbackReason = (typeof HANDBACK_REASONS)[number];

export const HANDBACK_REASON_LABEL: Record<HandbackReason, string> = {
  conflict_of_interest: "I know this patient or have a conflict",
  outside_competence: "Outside what I can safely advise on",
  needs_information: "It needs more information first",
  technical_problem: "A technical problem",
  other: "Another reason (please explain)",
};

export const answerWrittenQuestionSchema = z.object({
  consultId: z.string().uuid(),
  kind: z.enum(ANSWER_KINDS),
  body: z
    .string()
    .trim()
    .min(10, "The reply needs at least 10 characters.")
    .max(4000, "Please keep the reply under 4,000 characters."),
  // The attestation is a literal true: a reply with no attestation never reaches the database.
  attested: z.literal(true, { message: "Please confirm that you have not made a diagnosis." }),
});

export const handbackSchema = z
  .object({
    taskId: z.string().uuid(),
    reason: z.enum(HANDBACK_REASONS),
    note: z.string().trim().max(1000, "Please keep the note under 1,000 characters.").optional(),
  })
  .refine((v) => v.reason !== "other" || (v.note?.length ?? 0) >= 10, {
    message: "Please add a short note (10 characters or more) when the reason is Another reason.",
    path: ["note"],
  });

export const openQuestionParamsSchema = z.object({
  open: z.string().uuid().optional(),
  held: z.string().uuid().optional(),
  type: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/)
    .optional(),
});

export const attachmentParamsSchema = z.object({
  attachmentId: z.string().uuid(),
  consult: z.string().uuid(),
});

const ERROR_WORDS: Record<string, string> = {
  queue_not_clinician: "Your account is not set up as a clinician, so the queue is closed to you.",
  queue_not_eligible: "You are not currently cleared to take tasks. Check your credentials page.",
  queue_no_tier: "Your clinical tier has not been set yet. Ask an administrator.",
  queue_cooling_off: "You have handed back several tasks recently. The queue reopens in a few minutes.",
  queue_no_availability: "Declare that you are available for the queue first, then try again.",
  queue_no_claim: "You no longer hold this task. It may have timed out and returned to the queue.",
  queue_claim_expired: "Your hold on this task has run out. It has gone back to the queue.",
  queue_note_needed: "Please add a short note explaining the hand-back.",
  written_question_attest_no_diagnosis: "Please confirm that you have not made a diagnosis.",
  note_release_cmo_only: "This note is protected. Only the Chief Medical Officer can release it.",
  note_withhold_reason_needed: "Please give a reason (10 characters or more) for withholding the note.",
  note_amendment_reason_needed: "Please give a reason (10 characters or more) for the amendment.",
  note_correction_response_needed: "Please write a response (10 characters or more).",
};

export interface RpcErrorLike {
  message?: string | null;
  code?: string | null;
}

/** Turns a database error into words a clinician can act on. An unknown error is generic, never the raw SQL text. */
export function describeRpcError(error: RpcErrorLike | null | undefined, fallback = "Something went wrong. Please try again."): string {
  const message = error?.message ?? "";
  for (const key of Object.keys(ERROR_WORDS)) {
    if (message.includes(key)) return ERROR_WORDS[key] as string;
  }
  if (error?.code === "42501") return "You do not have access to do that.";
  if (message.includes("already answered")) return "This has already been answered.";
  return fallback;
}

// ----- result shapes ---------------------------------------------------------------------------------------

export const claimedQuestionSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  created_at: z.string(),
  window_due_at: z.string().nullable(),
  safety_flagged: z.boolean(),
  task_id: z.string().uuid().nullable(),
  claim_expires_at: z.string().nullable(),
  is_follow_up: z.boolean(),
});
export type ClaimedQuestion = z.infer<typeof claimedQuestionSchema>;

export const claimedQuestionsSchema = z.array(claimedQuestionSchema);

export const writtenQuestionSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  category: z.string(),
  question: z.string(),
  duration_note: z.string().nullable(),
  status: z.string(),
  task_id: z.string().uuid().nullable(),
  window_due_at: z.string().nullable(),
  safety_flagged: z.boolean(),
  answer: z.string().nullable(),
  answer_kind: z.string().nullable(),
  created_at: z.string(),
  photos: z.array(z.object({ id: z.string().uuid(), mime_type: z.string(), size_bytes: z.number() })),
  messages: z.array(
    z.object({ id: z.string().uuid(), author_role: z.string(), body: z.string(), created_at: z.string() }),
  ),
});
export type WrittenQuestion = z.infer<typeof writtenQuestionSchema>;

export const queueNextResultSchema = z.object({
  already_claimed: z.boolean(),
  claim_expires_at: z.string().nullable().optional(),
  reason: z.string().optional(),
  task: z
    .object({ id: z.string().uuid(), type: z.string(), priority_class: z.number().nullable().optional() })
    .nullable(),
});
export type QueueNextResult = z.infer<typeof queueNextResultSchema>;

export const WRITTEN_QUESTION_TASK_TYPE = "async_question";
export const WRITTEN_QUESTION_CALL_TASK_TYPE = "written_question_call";
/** The only task types this page asks the queue for. A blood pressure review is never claimed from here. */
export const WRITTEN_QUESTION_TASK_TYPES: string[] = [WRITTEN_QUESTION_TASK_TYPE, WRITTEN_QUESTION_CALL_TASK_TYPE];

/**
 * The destination after a claim: a written question or a call stays on the page (each has its own list), anything
 * else (only possible when the clinician already held it, at the claim cap) shows the held notice with a hand-back.
 */
export function claimRedirectPath(result: QueueNextResult, base: string): string {
  if (!result.task) return `${base}?none=1`;
  if (WRITTEN_QUESTION_TASK_TYPES.includes(result.task.type)) return base;
  const params = new URLSearchParams({ held: result.task.id, type: result.task.type });
  return `${base}?${params.toString()}`;
}

export const callDoneSchema = z.object({
  taskId: z.string().uuid(),
  note: z
    .string()
    .trim()
    .min(10, "Please write a short note about the call (10 characters or more).")
    .max(1000, "Please keep the note under 1,000 characters."),
});

export const heldCallTaskSchema = z.object({
  task_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  due_at: z.string().nullable(),
  claim_expires_at: z.string().nullable(),
});
export type HeldCallTask = z.infer<typeof heldCallTaskSchema>;
export const heldCallTasksSchema = z.array(heldCallTaskSchema);
