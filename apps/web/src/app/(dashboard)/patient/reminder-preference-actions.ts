"use server";

import { createClient } from "@/lib/supabase/server";

export type UpdateReminderPreferenceState = { success?: boolean; error?: string } | undefined;

/**
 * Saves profiles.preferred_reminder_channel — the switch that lets an
 * opted-in patient get a Termii voice call instead of WhatsApp for
 * reminders (private.remap_notification_channel transparently remaps a
 * queued 'whatsapp' row to 'voice' at insert time, so nothing else on the
 * platform needs to know this preference exists). Built for patients who
 * don't read WhatsApp, e.g. an elder on a ParentCare plan.
 */
export async function updateReminderPreference(
  _prevState: UpdateReminderPreferenceState,
  formData: FormData
): Promise<UpdateReminderPreferenceState> {
  const raw = formData.get("preferred_reminder_channel");
  const value = raw === "voice" ? "voice" : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({ preferred_reminder_channel: value })
    .eq("id", user.id);
  if (error) return { error: error.message };

  return { success: true };
}
