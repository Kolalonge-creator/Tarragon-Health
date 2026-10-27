import { z } from "zod";

/** S80d (25.4): one thread per patient across app, phone and email. The database function runs as the caller, so row-level security decides what is returned. */
export const threadRowSchema = z.object({
  kind: z.enum(["ticket", "reply"]),
  ticket_id: z.string().uuid(),
  entry_id: z.string().uuid(),
  channel: z.enum(["in_app", "phone", "email", "faq", "chatbot"]),
  at: z.string(),
  author: z.string(),
  body: z.string(),
  is_internal: z.boolean(),
  red_flagged: z.boolean(),
});
export type ThreadRow = z.infer<typeof threadRowSchema>;
export const threadRowsSchema = z.array(threadRowSchema);

export const CHANNEL_WORDS: Record<ThreadRow["channel"], string> = { in_app: "App", phone: "Phone", email: "Email", faq: "Help page", chatbot: "Chat" };

/** Oldest first for reading as a conversation; the database returns newest first. Does not mutate its input. */
export const readingOrder = (rows: readonly ThreadRow[]): ThreadRow[] => [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/** Which channels appear, in a fixed order, for the page summary. */
export function channelsIn(rows: readonly ThreadRow[]): ThreadRow["channel"][] {
  const order: ThreadRow["channel"][] = ["in_app", "phone", "email", "faq", "chatbot"];
  return order.filter((c) => rows.some((r) => r.channel === c));
}
