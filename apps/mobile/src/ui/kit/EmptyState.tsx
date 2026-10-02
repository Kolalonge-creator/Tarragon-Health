import { View } from "react-native";
import { radii, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * For a list with nothing in it yet. Never use it for a failed load: an error
 * must say it failed (the health-record rule: a failed read is never shown as
 * "none").
 */
export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", gap: space.md, paddingVertical: space.xxxl, paddingHorizontal: space.xl }}>
      <View style={{ width: 56, height: 56, borderRadius: radii.pill, backgroundColor: colors.brandTint, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={26} tone="brandText" />
      </View>
      <AppText variant="title" align="center" heading>
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" tone="textMuted" align="center">
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} fullWidth={false} /> : null}
    </View>
  );
}
