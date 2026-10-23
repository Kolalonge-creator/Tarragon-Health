import { View } from "react-native";
import { t } from "@tarragon/i18n";
import { space, useTheme } from "@/ui/design";
import { AppText, Card, Icon } from "@/ui/kit";
import { CycleActionButton, CycleListen } from "@/ui/cycle-parts";

/**
 * Danger signs for the cycle section. Rendered OUTSIDE the private lock on purpose (S66): the same for everybody, no personal data, no
 * phone number, so a locked screen still tells anyone that heavy bleeding, fainting or severe pain means go to a hospital now.
 *
 * UI-A: follows the standard alert template, in this order: the one step first (what to do), then what to look out for, what it may mean, a button to message the
 * care team. No exclamation marks, no capitals-only words. This is a true clinical safety card, so it keeps the red edge; nothing
 * else on the cycle screen does. Words are proposed copy awaiting CMO review (packages/i18n cycle-copy.ts).
 */
export function CycleDangerSigns({ onMessageCareTeam }: { onMessageCareTeam?: () => void }) {
  const { colors } = useTheme();
  return (
    <Card style={{ gap: space.md, borderLeftWidth: 4, borderLeftColor: colors.dangerText }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name="alert" size={20} tone="dangerText" />
        <AppText variant="title" heading tone="dangerText" style={{ flex: 1 }}>
          {t("cycle.danger.title")}
        </AppText>
        <CycleListen card="danger" />
      </View>

      <View style={{ gap: space.xs }}>
        <AppText variant="bodyStrong">{t("cycle.danger.step_label")}</AppText>
        <AppText variant="body">{t("cycle.danger.intro")}</AppText>
        <AppText variant="body" tone="textMuted">
          {t("cycle.danger.soon")}
        </AppText>
      </View>

      <View style={{ gap: space.xs }}>
        <AppText variant="bodyStrong">{t("cycle.danger.noticed_label")}</AppText>
        {(["cycle.danger.item_1", "cycle.danger.item_2", "cycle.danger.item_3", "cycle.danger.item_4"] as const).map((k) => (
          <AppText key={k} variant="body">
            {"• "}
            {t(k)}
          </AppText>
        ))}
      </View>

      <View style={{ gap: space.xs }}>
        <AppText variant="bodyStrong">{t("cycle.danger.meaning_label")}</AppText>
        <AppText variant="body">{t("cycle.danger.meaning")}</AppText>
      </View>

      {onMessageCareTeam ? <CycleActionButton title={t("cycle.danger.message_button")} variant="secondary" onPress={onMessageCareTeam} /> : null}
    </Card>
  );
}
