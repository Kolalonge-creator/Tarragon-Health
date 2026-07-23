"use server";

import { createClient } from "@/lib/supabase/server";

export type ReminderPreferencesState = { message?: string; error?: string } | undefined;

const LANGUAGES = new Set(["en", "pcm", "yo", "ha", "ig"]);

export async function updateReminderPreferences(
  _prev: ReminderPreferencesState,
  formData: FormData
): Promise<ReminderPreferencesState> {
  const channelRaw = formData.get("channel");
  const languageRaw = formData.get("language");

  const channel = channelRaw === "voice" ? "voice" : null;
  const language =
    typeof languageRaw === "string" && LANGUAGES.has(languageRaw) ? languageRaw : "en";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update({ preferred_reminder_channel: channel, language })
    .eq("id", user.id);
  if (error) return { error: "Could not save your preferences — try again." };

  return { message: "Saved. Future reminders will follow these preferences." };
}
