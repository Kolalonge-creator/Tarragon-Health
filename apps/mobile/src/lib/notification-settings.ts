import type { SupabaseClient } from "@supabase/supabase-js";
import { fromRow, healthFromRow, type DeliveryHealth, type NotificationSettingsValue } from "@tarragon/shared";
import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * Quiet hours and discreet mode (S13). The tables and the RPC are newer than the generated `Database` type, so this
 * re-types the shared client for these calls only (same approach as notification-preferences.ts). Writes go only
 * through `set_my_notification_settings()`, which also writes `profiles.discreet_mode`.
 */
type SettingsRow = { profile_id: string; organisation_id: string; quiet_enabled: boolean; quiet_start: string; quiet_end: string; updated_at: string };
type ProfileRow = { id: string; discreet_mode: boolean };
type SettingsDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      notification_settings: { Row: SettingsRow; Insert: SettingsRow; Update: Partial<SettingsRow>; Relationships: [] };
      profiles: { Row: ProfileRow; Insert: ProfileRow; Update: Partial<ProfileRow>; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      my_notification_delivery_health: {
        Args: { p_days: number };
        Returns: Array<{ push_sent: number; push_delivered: number; push_opened: number; push_failed: number; token_dead: number; active_push_devices: number }>;
      };
      report_notification_opened: { Args: { p_notification_id: string }; Returns: undefined };
      set_my_notification_settings: {
        Args: { p_quiet_enabled: boolean; p_quiet_start: string; p_quiet_end: string; p_discreet: boolean };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const client = supabase as unknown as SupabaseClient<SettingsDatabase>;

export async function loadNotificationSettings(profileId: string): Promise<QueryResult<NotificationSettingsValue>> {
  const [row, profile] = await Promise.all([
    client.from("notification_settings").select("*").eq("profile_id", profileId).maybeSingle(),
    client.from("profiles").select("id, discreet_mode").eq("id", profileId).maybeSingle(),
  ]);
  if (row.error) return { ok: false, error: row.error.message };
  return { ok: true, data: fromRow(row.data, profile.data?.discreet_mode) };
}

export async function saveNotificationSettings(v: NotificationSettingsValue): Promise<QueryResult<null>> {
  const { error } = await client.rpc("set_my_notification_settings", {
    p_quiet_enabled: v.quietEnabled,
    p_quiet_start: v.quietStart,
    p_quiet_end: v.quietEnd,
    p_discreet: v.discreet,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** The person's own push counts for the last 14 days (S13b). Null when the call fails: the card then says it cannot tell. */
export async function loadDeliveryHealth(): Promise<DeliveryHealth | null> {
  const { data, error } = await client.rpc("my_notification_delivery_health", { p_days: 14 });
  if (error) return null;
  return healthFromRow(data?.[0]);
}

/** Tells the server this notification was opened, so an unopened push can fall back to one email. Best effort. */
export async function reportNotificationOpened(notificationId: string): Promise<void> {
  try {
    await client.rpc("report_notification_opened", { p_notification_id: notificationId });
  } catch {
    // never blocks the app
  }
}
