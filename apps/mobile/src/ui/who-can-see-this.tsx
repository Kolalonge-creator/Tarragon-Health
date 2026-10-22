import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText } from "@/ui/legacy-kit";

/**
 * "Who can see this" (UI-B change 5), the phone peer of apps/web/src/components/privacy/who-can-see-this.tsx. Three rows with one
 * sentence of consequence each, a preview of what someone in the Care Circle would see, and the limit stated. The rows are not switches
 * because the care team summary cannot be paused here yet, and the words say so. Words: packages/i18n (`uib.who.*`, review pending).
 */
export const WHO_CAN_SEE_ROWS = [
  { id: "only_me", title: "uib.who.only_me.title", body: "uib.who.only_me.body" },
  { id: "care_team", title: "uib.who.care_team.title", body: "uib.who.care_team.body" },
  { id: "circle", title: "uib.who.circle.title", body: "uib.who.circle.body" },
] as const;

export function WhoCanSeeThis() {
  const colors = useLegacyColors();
  return (
    <Card style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>
        {t("uib.who.title")}
      </Text>
      <MutedText>{t("uib.who.intro")}</MutedText>
      {WHO_CAN_SEE_ROWS.map((r) => (
        <View key={r.id} style={{ gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t(r.title)}</Text>
          <Text style={{ fontSize: 14, color: colors.ink }}>{t(r.body)}</Text>
        </View>
      ))}
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{t("uib.who.preview.title")}</Text>
        <Text style={{ fontSize: 14, color: colors.ink }}>{t("uib.who.preview.none")}</Text>
        <Text style={{ fontSize: 14, color: colors.ink }}>{t("uib.who.preview.granted")}</Text>
        <Text style={{ fontSize: 14, color: colors.ink }}>{t("uib.who.preview.notifications")}</Text>
      </View>
      <MutedText>{t("uib.who.limit")}</MutedText>
    </Card>
  );
}
