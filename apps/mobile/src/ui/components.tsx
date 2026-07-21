import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, radius, spacing } from "./theme";

interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function PrimaryButton({ title, onPress, disabled, loading }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: disabled ? colors.faint : pressed ? colors.brandPressed : colors.brand,
        borderRadius: radius.control,
        paddingVertical: 14,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "600" }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: pressed ? "#F5F5F4" : colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.control,
        paddingVertical: 13,
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

/** Compact pill used for inline choices (e.g. glucose context). */
export function ChoiceChip({ title, onPress }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.brandPressed : colors.brand,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 14,
      })}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontSize: 24, fontWeight: "700", color: colors.ink }}>{children}</Text>
  );
}

export function MutedText({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.danger, fontSize: 14 }}>{children}</Text>;
}
