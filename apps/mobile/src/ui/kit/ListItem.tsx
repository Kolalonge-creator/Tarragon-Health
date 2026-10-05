import type { ReactNode } from "react";
import { View } from "react-native";
import { radii, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { Icon, type IconName } from "./Icon";
import { PressableScale } from "./PressableScale";

interface ListItemProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  trailing?: ReactNode | "chevron";
  onPress?: () => void;
  accessibilityHint?: string;
}

export function ListItem({ title, subtitle, icon, trailing = "chevron", onPress, accessibilityHint }: ListItemProps) {
  const { colors } = useTheme();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg }}>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={18} tone="brandText" />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle ? (
          <AppText variant="caption" tone="textMuted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing === "chevron" ? onPress ? <Icon name="next" size={18} tone="textSubtle" /> : null : trailing}
    </View>
  );

  if (!onPress) return body;
  return (
    <PressableScale onPress={onPress} scaleTo={0.99} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} accessibilityHint={accessibilityHint}>
      {body}
    </PressableScale>
  );
}
