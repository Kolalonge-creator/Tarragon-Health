"use server";

import { createClient } from "@/lib/supabase/server";

export type UpdateCommunicationPreferencesState = { success?: boolean; error?: string } | undefined;

const VALID_CHANNELS = ["whatsapp", "sms", "email", "push"] as const;

/**
 * Health Communication Engine — patient-controlled preferences (17.15).
 * Saves profiles.notification_channel_preference, .marketing_opt_in, and
 * .preferred_reminder_hour (the local hour, Africa/Lagos, that non-urgent
 * reminders should wait for — see private.next_send_after_for_hour(), read
 * by queue_vitals_reminders/queue_medication_checkin_reminders only).
 * Never touches profiles.language — that column has no live send-pipeline
 * consumer (English-only by founder decision, 2026-08-03) and surfacing a
 * language picker that silently keeps sending English would over-promise.
 * Critical/clinical notifications are never gated by any of these settings —
 * see private.remap_notification_channel(), notification_broadcasts.is_marketing,
 * and the send_after column comment (never set on priority=critical rows).
 */
export async function updateCommunicationPreferences(
  _prevState: UpdateCommunicationPreferencesState,
  formData: FormData,
): Promise<UpdateCommunicationPreferencesState> {
  const rawChannel = formData.get("notification_channel_preference");
  const channel: (typeof VALID_CHANNELS)[number] | null =
    typeof rawChannel === "string" && VALID_CHANNELS.includes(rawChannel as (typeof VALID_CHANNELS)[number])
      ? (rawChannel as (typeof VALID_CHANNELS)[number])
      : null;
  const marketingOptIn = formData.get("marketing_opt_in") === "on";

  const rawHour = formData.get("preferred_reminder_hour");
  const parsedHour = typeof rawHour === "string" && rawHour !== "" ? Number(rawHour) : NaN;
  const preferredReminderHour =
    Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({
      notification_channel_preference: channel,
      marketing_opt_in: marketingOptIn,
      preferred_reminder_hour: preferredReminderHour,
    })
    .eq("id", user.id);
  if (error) return { error: error.message };

  return { success: true };
}
