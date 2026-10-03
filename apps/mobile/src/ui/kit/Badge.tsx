import { View } from "react-native";
import { radii, space, useTheme, type Palette } from "../design";
import { AppText, type TextTone } from "./AppText";
import { Icon, type IconName } from "./Icon";

export type BadgeTone = "neutral" | "positive" | "warn" | "danger" | "emergency";

const SPEC: Record<BadgeTone, { fill: keyof Palette; text: TextTone; icon?: IconName }> = {
  neutral: { fill: "surfaceMuted", text: "textMuted" },
  positive: { fill: "brandTint", text: "brandText", icon: "done" },
  warn: { fill: "warnBg", text: "warnText", icon: "alert" },
  danger: { fill: "dangerBg", text: "dangerText", icon: "alert" },
  emergency: { fill: "emergency", text: "textOnEmergency", icon: "alert" },
};

/**
 * A status chip. The meaning is carried by the words and the icon, never by
 * colour alone (colour-blind-safe traffic lights, spec D.2). Red tones are for
 * true alerts only.
 */
export function Badge({ label, tone = "neutral" }: { label: string; tone?: BadgeTone }) {
  const { colors } = useTheme();
  const spec = SPEC[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: space.xs,
        backgroundColor: colors[spec.fill],
        borderRadius: radii.pill,
        paddingVertical: space.xs,
        paddingHorizontal: space.md,
      }}
    >
      {spec.icon ? <Icon name={spec.icon} size={12} tone={spec.text === "textOnEmergency" ? "textOnEmergency" : spec.text} /> : null}
      <AppText variant="label" tone={spec.text}>
        {label}
      </AppText>
    </View>
  );
}
