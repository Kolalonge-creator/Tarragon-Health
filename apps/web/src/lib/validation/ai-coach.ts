import { z } from "zod";

export const coachMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1, "Message can't be empty").max(2000, "Message is too long"),
});
export type CoachMessageInput = z.infer<typeof coachMessageSchema>;
