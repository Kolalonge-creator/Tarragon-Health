import { z } from "zod";

/**
 * S54 8.12: shapes for the pharmacist chat. The database is the protection (patient and the pharmacists of ONE listable pharmacy only,
 * every pharmacist read audited, chat text never in a notification); these schemas only make a bad answer a load failure on screen.
 */
export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_TOPIC_LENGTH = 120;

export const chatPharmacySchema = z.object({ partner_id: z.string().uuid(), partner_name: z.string(), state: z.string().nullable(), city: z.string().nullable() });
export const chatPharmaciesSchema = z.array(chatPharmacySchema);
export type ChatPharmacy = z.infer<typeof chatPharmacySchema>;

export const patientThreadSchema = z.object({
  thread_id: z.string().uuid(),
  partner_name: z.string(),
  topic: z.string(),
  status: z.string(),
  escalated: z.boolean(),
  last_message_at: z.string(),
  unread: z.number(),
});
export const patientThreadsSchema = z.array(patientThreadSchema);
export type PatientThread = z.infer<typeof patientThreadSchema>;

export const patientMessageSchema = z.object({
  message_id: z.string().uuid(),
  sender_role: z.enum(["patient", "pharmacist"]),
  body: z.string(),
  created_at: z.string(),
  flagged_potential_emergency: z.boolean(),
});
export const patientMessagesSchema = z.array(patientMessageSchema);
export type PatientMessage = z.infer<typeof patientMessageSchema>;

export const pharmacistThreadSchema = z.object({
  thread_id: z.string().uuid(),
  patient_first_name: z.string().nullable(),
  topic: z.string(),
  status: z.string(),
  escalated: z.boolean(),
  last_message_at: z.string(),
  waiting: z.boolean(),
  possible_emergency: z.boolean(),
});
export const pharmacistThreadsSchema = z.array(pharmacistThreadSchema);
export type PharmacistThread = z.infer<typeof pharmacistThreadSchema>;

export const pharmacistMessageSchema = z.object({
  message_id: z.string().uuid(),
  sender_role: z.enum(["patient", "pharmacist"]),
  body: z.string(),
  created_at: z.string(),
  patient_first_name: z.string().nullable(),
  medicine: z.string().nullable(),
  dose: z.string().nullable(),
  possible_emergency: z.boolean(),
});
export const pharmacistMessagesSchema = z.array(pharmacistMessageSchema);
export type PharmacistMessage = z.infer<typeof pharmacistMessageSchema>;

export const sendResultSchema = z.object({ emergency: z.boolean(), thread_id: z.string().uuid().optional() });

/** What a screen may send: trimmed, non-empty, within the same limits the database enforces. */
export function validMessage(body: string): string | null {
  const t = body.trim();
  return t.length >= 1 && t.length <= MAX_MESSAGE_LENGTH ? t : null;
}
export function validTopic(topic: string): string | null {
  const t = topic.trim();
  return t.length >= 1 && t.length <= MAX_TOPIC_LENGTH ? t : null;
}

/** Database errors the screen explains in plain words; anything else is a plain failure that changed nothing. */
export type ChatErrorKind = "closed" | "too_many" | "not_available" | "failed";
export function chatErrorKind(message: string | undefined): ChatErrorKind {
  if (message?.includes("thread_closed")) return "closed";
  if (message?.includes("too_many_messages")) return "too_many";
  if (message?.includes("pharmacy_not_available")) return "not_available";
  return "failed";
}
