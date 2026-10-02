import { ActivityIndicator, View } from "react-native";
import { radii, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { PressableScale } from "./PressableScale";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** Fills the width of its container (the default for primary actions on a screen). */
  fullWidth?: boolean;
  accessibilityHint?: string;
}

export function Button({ title, onPress, variant = "primary", disabled, loading, fullWidth = true, accessibilityHint }: ButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const fill = variant === "primary" ? colors.brand : variant === "secondary" ? colors.surface : "transparent";
  const tone = variant === "primary" ? "textOnBrand" : variant === "secondary" ? "text" : "brandText";

  return (
    <PressableScale
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={{
        minHeight: 48,
        borderRadius: radii.md,
        backgroundColor: fill,
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: colors.border,
        paddingHorizontal: space.xl,
        alignItems: "center",
        justifyContent: "center",
        alignSelf: fullWidth ? "stretch" : "flex-start",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {loading ? <ActivityIndicator size="small" color={variant === "primary" ? colors.textOnBrand : colors.brandText} /> : null}
        <AppText variant="bodyStrong" tone={tone}>
          {title}
        </AppText>
      </View>
    </PressableScale>
  );
}
