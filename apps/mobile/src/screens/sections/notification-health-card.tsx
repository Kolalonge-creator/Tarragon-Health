import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { diagnose, type DeliveryHealth, type DiagnosisFinding, type PermissionLevel } from "@tarragon/shared";
import { useUiLanguage } from "@/lib/ui-language";
import { loadDeliveryHealth } from "@/lib/notification-settings";
import { getNotificationPermission } from "@/lib/reminder-notifications";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText, PrimaryButton } from "@/ui/legacy-kit";
import { Text } from "react-native";

const FINDING_KEY: Record<DiagnosisFinding, MessageKey> = {
  permission_off: "notif.diag.permission_off",
  no_device_registered: "notif.diag.no_device_registered",
  token_dead: "notif.diag.token_dead",
  receipts_failing: "notif.diag.receipts_failing",
  never_opened: "notif.diag.never_opened",
  not_enough_data: "notif.diag.not_enough_data",
  all_good: "notif.diag.all_good",
};

const androidConstants = (): { Brand?: string; Manufacturer?: string } =>
  Platform.OS === "android" ? ((Platform.constants as { Brand?: string; Manufacturer?: string }) ?? {}) : {};

/**
 * "Notifications not arriving?" (S13b). Reads the phone's permission and the person's own delivery counts, names the
 * most likely cause, and shows steps for this make of phone (Tecno, Infinix and Itel stop apps in the background).
 * Never run on a real phone yet: the brand strings come from Platform.constants and need a check on a Tecno handset.
 */
export function NotificationHealthCard() {
  const colors = useLegacyColors();
  const language = asLocale(useUiLanguage());
  const tr = (key: MessageKey) => t(key, language);
  const [state, setState] = useState<{ permission: PermissionLevel; health: DeliveryHealth | null } | null>(null);

  const check = useCallback(async () => {
    const [permission, health] = await Promise.all([getNotificationPermission(), loadDeliveryHealth()]);
    setState({ permission: permission as PermissionLevel, health });
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (!state) return null;
  const { Brand, Manufacturer } = androidConstants();
  const d = diagnose({ os: Platform.OS, brand: Brand, manufacturer: Manufacturer, permission: state.permission, health: state.health });
  const needsSteps = d.findings.some((f) => f !== "all_good" && f !== "not_enough_data");
  const steps: MessageKey = d.maker === "transsion" ? "notif.diag.steps_transsion" : d.maker === "ios" ? "notif.diag.steps_ios" : "notif.diag.steps_android";

  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{tr("notif.diag.title")}</Text>
      <MutedText>{tr("notif.diag.intro")}</MutedText>
      {d.findings.map((f) => (
        <Text key={f} style={{ fontSize: 13.5, color: colors.ink }}>
          {tr(FINDING_KEY[f])}
        </Text>
      ))}
      {needsSteps && (
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>{tr("notif.diag.steps_title")}</Text>
          <MutedText>{tr(steps)}</MutedText>
          <PrimaryButton title={tr("notif.diag.open_settings")} onPress={() => void Linking.openSettings()} />
        </View>
      )}
      <MutedText>{tr("notif.diag.inbox_note")}</MutedText>
      <PrimaryButton title={tr("notif.diag.check_again")} onPress={() => void check()} />
    </Card>
  );
}
