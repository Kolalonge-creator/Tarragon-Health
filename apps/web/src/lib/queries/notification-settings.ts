import { createBrowserClient } from "@supabase/ssr";
import { fromRow, type NotificationSettingsValue } from "@tarragon/shared";

/**
 * Quiet hours and discreet mode (S13). Same self-contained client typing as notification-preferences.ts: the tables are
 * newer than the generated `Database` type, and intersecting them into it collapses the client generics to `never`.
 * Writes go only through `set_my_notification_settings()`, which also writes `profiles.discreet_mode`.
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
      set_my_notification_settings: {
        Args: { p_quiet_enabled: boolean; p_quiet_start: string; p_quiet_end: string; p_discreet: boolean };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const client = () =>
  createBrowserClient<SettingsDatabase>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function loadNotificationSettings(profileId: string): Promise<NotificationSettingsValue> {
  const supabase = client();
  const [{ data: row }, { data: profile }] = await Promise.all([
    supabase.from("notification_settings").select("*").eq("profile_id", profileId).maybeSingle(),
    supabase.from("profiles").select("id, discreet_mode").eq("id", profileId).maybeSingle(),
  ]);
  return fromRow(row, profile?.discreet_mode);
}

export async function saveNotificationSettings(v: NotificationSettingsValue): Promise<boolean> {
  const { error } = await client().rpc("set_my_notification_settings", {
    p_quiet_enabled: v.quietEnabled,
    p_quiet_start: v.quietStart,
    p_quiet_end: v.quietEnd,
    p_discreet: v.discreet,
  });
  return !error;
}
