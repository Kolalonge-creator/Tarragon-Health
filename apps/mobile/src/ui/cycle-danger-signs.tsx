import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { useLegacyColors } from "@/ui/design";
import { Card } from "@/ui/legacy-kit";

/**
 * Danger signs for the cycle section. Rendered OUTSIDE the private lock on purpose (S66): the same for everybody, no personal data, no
 * phone number, so a locked screen still tells anyone that heavy bleeding, fainting or severe pain means go to a hospital now. Words are
 * proposed copy awaiting CMO review (packages/i18n cycle-copy.ts).
 */
export function CycleDangerSigns() {
  const colors = useLegacyColors();
  return (
    <Card style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: colors.danger }}>
      <Text accessibilityRole="header" style={{ fontSize: 14, fontWeight: "700", color: colors.danger }}>
        {t("cycle.danger.title")}
      </Text>
      <Text style={{ fontSize: 13, color: colors.ink }}>{t("cycle.danger.intro")}</Text>
      <View style={{ gap: 3 }}>
        {(["cycle.danger.item_1", "cycle.danger.item_2", "cycle.danger.item_3", "cycle.danger.item_4"] as const).map((k) => (
          <Text key={k} style={{ fontSize: 13, color: colors.ink }}>
            {"• "}
            {t(k)}
          </Text>
        ))}
      </View>
      <Text style={{ fontSize: 13, color: colors.ink }}>{t("cycle.danger.soon")}</Text>
    </Card>
  );
}
