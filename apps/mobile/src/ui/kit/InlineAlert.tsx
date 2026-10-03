import { View } from "react-native";
import { radii, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { Icon } from "./Icon";

type AlertTone = "warn" | "danger" | "info";

/**
 * An in-page notice: amber for "needs a look", red for a real problem, plain for
 * information. Announced when it appears. The wording must be calm (house voice:
 * no fear-based urgency); the colour only supports it.
 */
export function InlineAlert({ message, tone = "warn" }: { message: string; tone?: AlertTone }) {
  const { colors } = useTheme();
  const fill = tone === "warn" ? colors.warnBg : tone === "danger" ? colors.dangerBg : colors.surfaceMuted;
  const text = tone === "warn" ? "warnText" : tone === "danger" ? "dangerText" : "textMuted";
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", gap: space.sm, backgroundColor: fill, borderRadius: radii.md, padding: space.md }}
    >
      <Icon name={tone === "info" ? "info" : "alert"} size={16} tone={text} />
      <AppText variant="body" tone={text} style={{ flex: 1 }}>
        {message}
      </AppText>
    </View>
  );
}
