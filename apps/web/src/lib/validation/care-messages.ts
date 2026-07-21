import { z } from "zod";

/** Starting a new care-team message thread. */
export const startThreadSchema = z.object({
  subject: z.string().trim().min(3, "Give your message a short subject").max(150),
  body: z.string().trim().min(1, "Write a message").max(4000),
});
export type StartThreadInput = z.infer<typeof startThreadSchema>;

/** Posting a reply into an existing thread. */
export const postMessageSchema = z.object({
  body: z.string().trim().min(1, "Write a message").max(4000),
});
export type PostMessageInput = z.infer<typeof postMessageSchema>;
