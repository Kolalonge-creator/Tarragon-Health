import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { DEFAULT_SETTINGS, normaliseTime, validateSettings, type NotificationSettingsValue } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { loadNotificationSettings, saveNotificationSettings } from "@/lib/notification-settings";
import { NotificationHealthCard } from "./notification-health-card";
import {
  loadNotificationPreferences,
  updateNotificationPreference,
  channelTogglesFromRow,
  type NotificationChannel,
  NOTIFICATION_PREFERENCE_CATEGORIES,
  type NotificationPreferenceCategory,
  type PatientNotificationPreferenceRow,
} from "@/lib/notification-preferences";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Badge, Card, ErrorText, MutedText, PrimaryButton, SectionDivider } from "@/ui/legacy-kit";

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

/**
 * There is no SMS preference any more (S42, INV-08): SMS is for verification codes only. This app renders Email and Push.
 */
const DISPLAYED_CHANNELS: { key: NotificationChannel; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "push", label: "Push" },
];

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
  const colors = useLegacyColors();
  const language = asLocale(useUiLanguage());
  const tr = (key: MessageKey) => t(key, language);
  const [delivery, setDelivery] = useState<NotificationSettingsValue>(DEFAULT_SETTINGS);
  const [deliveryReady, setDeliveryReady] = useState(false);
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);

  useEffect(() => {
    void loadNotificationSettings(patientId).then((r) => {
      if (r.ok) setDelivery(r.data);
      setDeliveryReady(true);
    });
  }, [patientId]);

  async function saveDelivery() {
    setDeliveryNote(null);
    if (validateSettings(delivery) !== null) {
      setDeliveryNote(tr("notif.settings.error_times"));
      return;
    }
    const next = {
      ...delivery,
      quietStart: normaliseTime(delivery.quietStart) ?? delivery.quietStart,
      quietEnd: normaliseTime(delivery.quietEnd) ?? delivery.quietEnd,
    };
    const r = await saveNotificationSettings(next);
    setDeliveryNote(tr(r.ok ? "notif.settings.saved" : "notif.settings.error_save"));
  }
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

  async function handleToggle(category: NotificationPreferenceCategory, channel: NotificationChannel, nextValue: boolean) {
    const current = channelTogglesFromRow(rowsByCategory.get(category));
    const next = { ...current, [channel]: nextValue };
    setSavingCategory(category);
    setError(null);
    const result = await updateNotificationPreference({
      patientId,
      organisationId,
      category,
      emailEnabled: next.email,
      pushEnabled: next.push,
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

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{tr("notif.settings.quiet_title")}</Text>
        <MutedText>{tr("notif.settings.quiet_body")}</MutedText>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 13.5, color: colors.ink, flex: 1 }}>{tr("notif.settings.quiet_on")}</Text>
          <Switch
            value={delivery.quietEnabled}
            disabled={!deliveryReady}
            onValueChange={(v) => setDelivery({ ...delivery, quietEnabled: v })}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <MutedText>{tr("notif.settings.quiet_from")}</MutedText>
            <TextInput
              value={delivery.quietStart}
              editable={deliveryReady && delivery.quietEnabled}
              onChangeText={(v) => setDelivery({ ...delivery, quietStart: v })}
              placeholder="21:00"
              keyboardType="numbers-and-punctuation"
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.ink }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <MutedText>{tr("notif.settings.quiet_to")}</MutedText>
            <TextInput
              value={delivery.quietEnd}
              editable={deliveryReady && delivery.quietEnabled}
              onChangeText={(v) => setDelivery({ ...delivery, quietEnd: v })}
              placeholder="07:00"
              keyboardType="numbers-and-punctuation"
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.ink }}
            />
          </View>
        </View>
        <SectionDivider />
        <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{tr("notif.settings.discreet_title")}</Text>
        <MutedText>{tr("notif.settings.discreet_body")}</MutedText>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 13.5, color: colors.ink, flex: 1 }}>{tr("notif.settings.discreet_on")}</Text>
          <Switch
            value={delivery.discreet}
            disabled={!deliveryReady}
            onValueChange={(v) => setDelivery({ ...delivery, discreet: v })}
          />
        </View>
        <MutedText>{tr("notif.settings.lockscreen_note")}</MutedText>
        <PrimaryButton title={tr("notif.settings.save")} onPress={() => void saveDelivery()} />
        {deliveryNote && <MutedText>{deliveryNote}</MutedText>}
      </Card>

      <NotificationHealthCard />

      {loading && <ActivityIndicator color={colors.brand} />}
      {error && <ErrorText>{error}</ErrorText>}

      {!loading &&
        NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => {
          const toggles = channelTogglesFromRow(rowsByCategory.get(category));
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
              {DISPLAYED_CHANNELS.map(({ key, label }) => (
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
