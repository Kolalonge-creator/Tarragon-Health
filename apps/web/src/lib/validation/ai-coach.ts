import { z } from "zod";

export const coachMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1, "Message can't be empty").max(2000, "Message is too long"),
});
export type CoachMessageInput = z.infer<typeof coachMessageSchema>;

/** §36.5/§36.8/§36.9 quick actions — see ai-coach-quick-action.ts. */
export const quickActionSchema = z.object({
  conversationId: z.string().uuid().optional(),
  kind: z.enum(["explain_record", "care_plan_summary", "appointment_prep"]),
});
export type QuickActionInput = z.infer<typeof quickActionSchema>;
