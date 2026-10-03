import { useState } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET, radii, space, textStyles, useTheme } from "../design";
import { AppText } from "./AppText";
import { Icon } from "./Icon";

interface FieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  hint?: string;
  error?: string | null;
}

/**
 * A labelled text field. The label is always visible (never only a placeholder),
 * the error replaces the hint and is announced to screen readers, and the border
 * tells focus and error apart without relying on colour alone (the error also
 * carries an icon and text).
 */
export function Field({ label, hint, error, onFocus, onBlur, ...input }: FieldProps) {
  const { colors, scheme } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.dangerText : focused ? colors.focus : colors.border;

  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="label" tone="textMuted">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        keyboardAppearance={scheme}
        placeholderTextColor={colors.textSubtle}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          textStyles.bodyLarge,
          {
            minHeight: MIN_TARGET + 4,
            color: colors.text,
            backgroundColor: colors.surface,
            borderRadius: radii.md,
            borderWidth: focused || error ? 2 : 1,
            borderColor,
            paddingHorizontal: space.lg,
          },
        ]}
        {...input}
      />
      {error ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }} accessibilityLiveRegion="polite">
          <Icon name="alert" size={14} tone="dangerText" />
          <AppText variant="caption" tone="dangerText">
            {error}
          </AppText>
        </View>
      ) : hint ? (
        <AppText variant="caption" tone="textSubtle">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}
