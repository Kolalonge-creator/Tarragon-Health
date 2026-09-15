import { z } from "zod";

/** 77.4 conversation classification — kept in sync with the DB enum
 * care_message_category (20260830014522). */
export const careMessageCategories = [
  "clinical",
  "appointment",
  "medication",
  "laboratory",
  "pharmacy",
  "billing",
  "technical",
  "general",
] as const;
export type CareMessageCategory = (typeof careMessageCategories)[number];

/** Starting a new care-team message thread. */
export const startThreadSchema = z.object({
  subject: z.string().trim().min(3, "Give your message a short subject").max(150),
  body: z.string().trim().min(1, "Write a message").max(4000),
  category: z.enum(careMessageCategories).default("general"),
});
export type StartThreadInput = z.infer<typeof startThreadSchema>;

/** Posting a reply into an existing thread. */
export const postMessageSchema = z.object({
  body: z.string().trim().min(1, "Write a message").max(4000),
});
export type PostMessageInput = z.infer<typeof postMessageSchema>;

/** 77.7 clinician reply templates. */
export const careMessageTemplateCategories = [
  "result_communication",
  "appointment_follow_up",
  "medication_instructions",
  "monitoring_reminder",
  "general",
] as const;
export type CareMessageTemplateCategory = (typeof careMessageTemplateCategories)[number];

export const createTemplateSchema = z.object({
  title: z.string().trim().min(3, "Give the template a short title").max(150),
  body: z.string().trim().min(1, "Write the template text").max(4000),
  category: z.enum(careMessageTemplateCategories).default("general"),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

/** 77.10 attachments — mirrors the DB bucket's own allow-list
 * (care-message-attachments, 20260830014723) so a rejected upload is caught
 * client-side with a clear message instead of a raw storage error. */
export const CARE_MESSAGE_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const CARE_MESSAGE_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

export function validateCareMessageAttachment(file: File): string | null {
  if (file.size > CARE_MESSAGE_ATTACHMENT_MAX_BYTES) {
    return "File is larger than 15 MB";
  }
  if (!CARE_MESSAGE_ATTACHMENT_ALLOWED_MIME_TYPES.includes(file.type as never)) {
    return "Only PDF, JPEG, PNG, WEBP or HEIC files are supported";
  }
  return null;
}
