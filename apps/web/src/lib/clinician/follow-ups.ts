import { z } from "zod";

/**
 * S77 (23.8, S-20): the shapes the "My follow-ups" screen reads, and the one rule it repeats from the database: a follow-up closes only with an
 * outcome and a reason. Parsed with Zod because the generated types do not carry the newest functions yet. Pure.
 */
export const FOLLOW_UP_OUTCOMES = ["done", "declined", "not_needed", "other"] as const;
export type FollowUpOutcome = (typeof FOLLOW_UP_OUTCOMES)[number];
export const MIN_CLOSE_REASON_CHARS = 10;

export const followUpRowSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  patient_first_name: z.string(),
  kind: z.enum(["order", "referral", "lab_request", "follow_up"]),
  source_table: z.string().nullable(),
  abnormal_result: z.boolean(),
  owner_id: z.string().uuid(),
  due_at: z.string(),
  state: z.enum(["open", "acknowledged", "closed"]),
  overdue: z.boolean(),
  escalated_at: z.string().nullable(),
  escalation_route: z.enum(["raised", "to_pool"]).nullable(),
  outcome: z.enum(FOLLOW_UP_OUTCOMES).nullable(),
  outcome_reason: z.string().nullable(),
  closed_at: z.string().nullable(),
});
export type FollowUpRow = z.infer<typeof followUpRowSchema>;
export const followUpListSchema = z.array(followUpRowSchema);

export const closeFollowUpSchema = z.object({
  id: z.string().uuid(),
  outcome: z.enum(FOLLOW_UP_OUTCOMES),
  reason: z.string().trim().min(MIN_CLOSE_REASON_CHARS, "Say why in at least 10 characters.").max(1000),
});

export const followUpIdSchema = z.string().uuid();
