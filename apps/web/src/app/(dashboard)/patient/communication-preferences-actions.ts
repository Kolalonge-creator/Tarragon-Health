"use server";

import { createClient } from "@/lib/supabase/server";

export type UpdateCommunicationPreferencesState = { success?: boolean; error?: string } | undefined;

const VALID_CHANNELS = ["whatsapp", "sms", "email", "push"] as const;

/**
 * Health Communication Engine — patient-controlled preferences (17.15).
 * Saves profiles.notification_channel_preference and .marketing_opt_in.
 * Never touches profiles.language — that column has no live send-pipeline
 * consumer (English-only by founder decision, 2026-08-03) and surfacing a
 * language picker that silently keeps sending English would over-promise.
 * Critical/clinical notifications are never gated by either setting — see
 * private.remap_notification_channel() and notification_broadcasts.is_marketing.
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({ notification_channel_preference: channel, marketing_opt_in: marketingOptIn })
    .eq("id", user.id);
  if (error) return { error: error.message };

  return { success: true };
}
