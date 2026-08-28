import { z } from "zod";

/** §16.14 — communication preferences. Language is deliberately not exposed
 * here: the platform is English-only by founder decision (2026-08-03,
 * CLAUDE.md), so the column always writes "en" until that changes. Clinical
 * safety notifications bypass all of this (private.notification_allowed_now
 * in the notification_preferences migration) — nothing here can silence an
 * abnormal-result or red-flag alert. */
const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Expected HH:MM")
  .optional()
  .or(z.literal(""));

export const notificationPreferencesSchema = z
  .object({
    preferred_channel: z.enum(["whatsapp", "sms", "email", "push", "in_app"]),
    frequency: z.enum(["minimal", "normal", "frequent"]),
    quiet_hours_start: timeString,
    quiet_hours_end: timeString,
    email_enabled: z.coerce.boolean(),
    sms_enabled: z.coerce.boolean(),
    push_enabled: z.coerce.boolean(),
    whatsapp_enabled: z.coerce.boolean(),
    in_app_enabled: z.coerce.boolean(),
  })
  .refine((data) => !!data.quiet_hours_start === !!data.quiet_hours_end, {
    message: "Set both a quiet-hours start and end, or neither",
    path: ["quiet_hours_end"],
  });
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;
