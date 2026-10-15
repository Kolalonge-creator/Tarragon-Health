import { z } from "zod";

/** S80 (S-23): logging a phone call as a support ticket. The database finds the patient by phone and enforces every rule; this validates the shape and maps errors to fixed notices. */
export const phoneTicketSchema = z.object({
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/),
  subject: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
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
