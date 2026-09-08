import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Switch, Text, View } from "react-native";
import {
  loadNotificationPreferences,
  updateNotificationPreference,
  NOTIFICATION_PREFERENCE_CATEGORIES,
  type NotificationPreferenceCategory,
  type PatientNotificationPreferenceRow,
} from "@/lib/notification-preferences";
import { colors, spacing } from "@/ui/theme";
import { Badge, Card, ErrorText, MutedText, SectionDivider } from "@/ui/components";

const CATEGORY_LABEL: Record<NotificationPreferenceCategory, string> = {
  appointments: "Appointment reminders",
  medications: "Medication reminders",
  labs_results: "Lab & test results",
  screenings_vaccinations: "Screening & vaccination reminders",
  referrals: "Referral updates",
  care_messages: "Messages from your care team",
  education_wellness: "Health education & wellness",
  billing: "Billing & payments",
};

type Channel = "email" | "sms" | "push" | "whatsapp";
const CHANNELS: { key: Channel; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "push", label: "Push" },
  { key: "whatsapp", label: "WhatsApp" },
];

const ALL_CHANNELS_ON: Record<Channel, boolean> = { email: true, sms: true, push: true, whatsapp: true };

function togglesFromRow(row: PatientNotificationPreferenceRow | undefined): Record<Channel, boolean> {
  if (!row) return ALL_CHANNELS_ON;
  return { email: row.email_enabled, sms: row.sms_enabled, push: row.push_enabled, whatsapp: row.whatsapp_enabled };
}

interface NotificationSettingsScreenProps {
  patientId: string;
  organisationId: string;
}

/**
 * Per-category notification channel preferences — mirrors
 * apps/web/src/app/(dashboard)/patient/notification-settings/
 * notification-preferences-form.tsx. Critical health alerts are never a
 * toggle here — they always reach the patient in-app, and this screen is
 * scoped strictly to the routine send path.
 */
export function NotificationSettingsScreen({ patientId, organisationId }: NotificationSettingsScreenProps) {
  const [rows, setRows] = useState<PatientNotificationPreferenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState<NotificationPreferenceCategory | null>(null);

  const refresh = useCallback(async () => {
    const result = await loadNotificationPreferences(patientId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setRows(result.data);
  }, [patientId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const rowsByCategory = new Map(rows.map((row) => [row.category, row]));

  async function handleToggle(category: NotificationPreferenceCategory, channel: Channel, nextValue: boolean) {
    const current = togglesFromRow(rowsByCategory.get(category));
    const next = { ...current, [channel]: nextValue };
    setSavingCategory(category);
    setError(null);
    const result = await updateNotificationPreference({
      patientId,
      organisationId,
      category,
      emailEnabled: next.email,
      smsEnabled: next.sms,
      pushEnabled: next.push,
      whatsappEnabled: next.whatsapp,
    });
    setSavingCategory(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    void refresh();
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.screen, gap: 16 }}
    >
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Notification settings</Text>
        <MutedText>
          Choose how you&apos;d like to hear from us for each kind of update. Critical health alerts
          always reach you in the app.
        </MutedText>
      </View>

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Badge tone="neutral">Critical</Badge>
          <MutedText>Clinical safety alerts. Always in-app, can&apos;t be turned off.</MutedText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Badge tone="neutral">Important</Badge>
          <MutedText>Appointments, medications, referrals — on by default, adjustable below.</MutedText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Badge tone="neutral">Routine</Badge>
          <MutedText>Health education & wellness — the easiest to turn down.</MutedText>
        </View>
      </Card>

      {loading && <ActivityIndicator color={colors.brand} />}
      {error && <ErrorText>{error}</ErrorText>}

      {!loading &&
        NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => {
          const toggles = togglesFromRow(rowsByCategory.get(category));
          const isSaving = savingCategory === category;
          return (
            <Card key={category} style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>
                  {CATEGORY_LABEL[category]}
                </Text>
                {isSaving && <MutedText>Saving…</MutedText>}
              </View>
              <SectionDivider />
              {CHANNELS.map(({ key, label }) => (
                <View
                  key={key}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                >
                  <Text style={{ fontSize: 13.5, color: colors.ink }}>{label}</Text>
                  <Switch
                    value={toggles[key]}
                    onValueChange={(value) => void handleToggle(category, key, value)}
                    disabled={isSaving}
                  />
                </View>
              ))}
            </Card>
          );
        })}
    </ScrollView>
  );
}
