import { z } from "zod";

/**
 * S80d (Module 25.4): a staff member records an email as a support ticket. The text is PASTED by a person; nothing reads a mailbox and nothing
 * parses the email into an action. The database finds the patient by the exact email on the account and enforces every rule; this validates the
 * shape and maps errors to fixed notices.
 */
export const emailTicketSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  sender: z.string().trim().min(3).max(200),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(5000),
  priority: z.enum(["low", "normal", "high", "critical"]),
  clinical: z.boolean(),
});

export const NOTICES = ["logged", "logged_clinical", "bad_input", "no_match", "denied", "failed"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);

export function noticeForError(code: string | undefined): Notice {
  if (code === "42501") return "denied";
  if (code === "22023") return "no_match";
  return "failed";
}
