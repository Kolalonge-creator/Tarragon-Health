"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notificationPreferencesSchema } from "@/lib/validation/notification-preferences";

export type NotificationPreferencesActionState = { error?: string; success?: boolean } | undefined;

/** Sets/updates the caller's own notification preferences. Unchecked HTML
 * checkboxes never appear in FormData at all, so each channel toggle is read
 * by presence rather than value — `formData.get(...)` returning null means
 * unchecked, not "false" as a string. */
export async function setNotificationPreferencesAction(
  _prev: NotificationPreferencesActionState,
  formData: FormData
): Promise<NotificationPreferencesActionState> {
  const raw = {
    preferred_channel: formData.get("preferred_channel"),
    frequency: formData.get("frequency"),
    quiet_hours_start: formData.get("quiet_hours_start"),
    quiet_hours_end: formData.get("quiet_hours_end"),
    email_enabled: formData.get("email_enabled") != null,
    sms_enabled: formData.get("sms_enabled") != null,
    push_enabled: formData.get("push_enabled") != null,
    whatsapp_enabled: formData.get("whatsapp_enabled") != null,
    in_app_enabled: formData.get("in_app_enabled") != null,
  };
  const parsed = notificationPreferencesSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { quiet_hours_start, quiet_hours_end, ...rest } = parsed.data;
  const { error } = await supabase.from("notification_preferences").upsert(
    {
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      ...rest,
      quiet_hours_start: quiet_hours_start || null,
      quiet_hours_end: quiet_hours_end || null,
    },
    { onConflict: "patient_id" }
  );
  if (error) return { error: error.message };

  revalidatePath("/patient/profile");
  return { success: true };
}
