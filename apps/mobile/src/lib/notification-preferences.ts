import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * `patient_notification_preferences` isn't in the generated `Database` type
 * yet — see apps/web/src/lib/queries/notification-preferences.ts's own
 * extensive comment for why (an intersected schema past a certain size
 * collapses Supabase's generic resolution to `never`). Same workaround here,
 * adapted to reuse the single mobile `supabase` client instance (re-typed
 * for this one call) rather than standing up a second client with its own
 * auth/session machinery, which mobile can't casually duplicate the way a
 * per-request web client can.
 */
export const NOTIFICATION_PREFERENCE_CATEGORIES = [
  "appointments",
  "medications",
  "labs_results",
  "screenings_vaccinations",
  "referrals",
  "care_messages",
  "education_wellness",
  "billing",
] as const;

export type NotificationPreferenceCategory = (typeof NOTIFICATION_PREFERENCE_CATEGORIES)[number];

export type PatientNotificationPreferenceRow = {
  id: string;
  organisation_id: string;
  patient_id: string;
  category: NotificationPreferenceCategory;
  email_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  whatsapp_enabled: boolean;
  created_at: string;
  updated_at: string;
};

type PatientNotificationPreferenceInsert = Omit<
  PatientNotificationPreferenceRow,
  "id" | "email_enabled" | "sms_enabled" | "push_enabled" | "whatsapp_enabled" | "created_at" | "updated_at"
> &
  Partial<
    Pick<
      PatientNotificationPreferenceRow,
      "id" | "email_enabled" | "sms_enabled" | "push_enabled" | "whatsapp_enabled" | "created_at" | "updated_at"
    >
  >;

type NotificationPreferencesDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.5" };
  public: {
    Tables: {
      patient_notification_preferences: {
        Row: PatientNotificationPreferenceRow;
        Insert: PatientNotificationPreferenceInsert;
        Update: Partial<PatientNotificationPreferenceInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: { notification_preference_category: NotificationPreferenceCategory };
    CompositeTypes: Record<string, never>;
  };
};

const prefsClient = supabase as unknown as SupabaseClient<NotificationPreferencesDatabase>;

export async function loadNotificationPreferences(
  patientId: string
): Promise<QueryResult<PatientNotificationPreferenceRow[]>> {
  const { data, error } = await prefsClient
    .from("patient_notification_preferences")
    .select("*")
    .eq("patient_id", patientId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data ?? [] };
}

export async function updateNotificationPreference(input: {
  patientId: string;
  organisationId: string;
  category: NotificationPreferenceCategory;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
}): Promise<QueryResult<null>> {
  const { error } = await prefsClient.from("patient_notification_preferences").upsert(
    {
      patient_id: input.patientId,
      organisation_id: input.organisationId,
      category: input.category,
      email_enabled: input.emailEnabled,
      sms_enabled: input.smsEnabled,
      push_enabled: input.pushEnabled,
      whatsapp_enabled: input.whatsappEnabled,
    },
    { onConflict: "patient_id,category" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
