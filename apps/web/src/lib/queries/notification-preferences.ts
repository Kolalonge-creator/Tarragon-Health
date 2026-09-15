import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Spec §76.12/§76.13 — per-category notification channel preferences for
 * `patient_notification_preferences` (migration 20260829222502). Scoped
 * strictly to the ROUTINE send path (send-pending-notifications). The
 * separate, load-bearing critical-notification escalation engine
 * (private.enqueue_critical_notification /
 * private.escalate_unconfirmed_critical_notifications) never reads this
 * table and cannot be opted out of here — see the migration header.
 * `in_app` is deliberately not a column: it is the always-on safety net.
 *
 * NOTE (2026-08-29): the migration creating this table + its
 * notification_preference_category enum has not been applied to any
 * local/live database in this worktree session yet, so it does not appear
 * in the generated `Database` type from @tarragon/shared, and this file
 * can't use the shared `createClient()` / `Tables<"...">` pattern every
 * other file in this directory uses. The obvious fix — intersecting this
 * one table into the real, ~200-table generated `Database["public"]["Tables"]`
 * — was tried first and does not work: past a certain object size, the
 * Supabase client's own generic resolution (the `Schema extends
 * GenericSchema` check inside @supabase/postgrest-js) silently collapses to
 * `never` for the *whole* intersected schema (confirmed with an isolated
 * repro — a plain, un-intersected minimal Database type resolves fine, an
 * intersected one does not). So this file instead builds its own small,
 * self-contained `Database`-shaped type below, describing only this one
 * table, and a dedicated client typed against it — still fully typed, no
 * `any` anywhere, just not sharing the app's single generated schema. Once
 * database.types.ts is regenerated with this table present (after the
 * migration is actually applied), delete
 * `NotificationPreferencesDatabase`/`createNotificationPreferencesClient`
 * below and switch to the shared `createClient()` from
 * "@/lib/supabase/client" plus `Tables<"patient_notification_preferences">`.
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

export type NotificationPreferenceCategory =
  (typeof NOTIFICATION_PREFERENCE_CATEGORIES)[number];

export function isNotificationPreferenceCategory(
  value: string
): value is NotificationPreferenceCategory {
  return (NOTIFICATION_PREFERENCE_CATEGORIES as readonly string[]).includes(value);
}

// `type`, not `interface`, deliberately — see the file-level note above.
// TypeScript only infers an implicit index signature for a `type` alias's
// object shape, not for an `interface`; @supabase/postgrest-js's generic
// resolution needs that (each table's Row/Insert/Update must satisfy
// `Record<string, unknown>`) or the whole client generic silently
// collapses to `never` on tables added this way. Confirmed empirically:
// swapping these three back to `interface` alone reproduces the collapse.
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

type PatientNotificationPreferenceInsert = {
  id?: string;
  organisation_id: string;
  patient_id: string;
  category: NotificationPreferenceCategory;
  email_enabled?: boolean;
  sms_enabled?: boolean;
  push_enabled?: boolean;
  whatsapp_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
};

type PatientNotificationPreferenceUpdate = {
  id?: string;
  organisation_id?: string;
  patient_id?: string;
  category?: NotificationPreferenceCategory;
  email_enabled?: boolean;
  sms_enabled?: boolean;
  push_enabled?: boolean;
  whatsapp_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
};

/** A minimal, self-contained Supabase schema type covering only this one
 * table — see the file-level note above for why this isn't derived from
 * the app's real generated `Database` type. `PostgrestVersion` matches the
 * value in packages/shared/src/database.types.ts's own `__InternalSupabase`
 * so this client negotiates the same wire format as every other one. */
type NotificationPreferencesDatabase = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      patient_notification_preferences: {
        Row: PatientNotificationPreferenceRow;
        Insert: PatientNotificationPreferenceInsert;
        Update: PatientNotificationPreferenceUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      notification_preference_category: NotificationPreferenceCategory;
    };
    CompositeTypes: Record<string, never>;
  };
};

function createNotificationPreferencesClient() {
  return createBrowserClient<NotificationPreferencesDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export function notificationPreferencesKey(patientId: string) {
  return ["notification-preferences", patientId] as const;
}

/** All saved preference rows for a patient. A category with no row here
 * means "every channel on" (the table's own column defaults) — callers
 * should treat a missing category that way rather than fetching/creating a
 * placeholder row for it. */
export function useNotificationPreferences(patientId: string) {
  return useQuery({
    queryKey: notificationPreferencesKey(patientId),
    queryFn: async (): Promise<PatientNotificationPreferenceRow[]> => {
      const supabase = createNotificationPreferencesClient();
      const { data, error } = await supabase
        .from("patient_notification_preferences")
        .select("*")
        .eq("patient_id", patientId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface UpdateNotificationPreferenceInput {
  patientId: string;
  organisationId: string;
  category: NotificationPreferenceCategory;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
}

/** Upserts one (patient, category) row — the only way this table is ever
 * written from the UI. Every toggle change sends the full 4-channel state
 * for that category (the 3 unchanged channels merged with the 1 that just
 * flipped), never a partial row, so a row's absence-vs-presence stays a
 * clean "never touched this category" signal rather than a partially
 * filled-in one. */
export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateNotificationPreferenceInput) => {
      const supabase = createNotificationPreferencesClient();
      const { error } = await supabase
        .from("patient_notification_preferences")
        .upsert(
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
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: notificationPreferencesKey(variables.patientId),
      });
    },
  });
}
