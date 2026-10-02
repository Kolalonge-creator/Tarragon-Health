import { Text, type TextProps } from "react-native";
import { MAX_FONT_SCALE, textStyles, useTheme, type Palette, type TextVariant } from "../design";

export type TextTone = keyof Pick<
  Palette,
  "text" | "textMuted" | "textSubtle" | "brandText" | "warnText" | "dangerText" | "textOnBrand" | "textOnEmergency"
>;

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: TextTone;
  align?: "left" | "center" | "right";
  /** Marks the text as a heading for screen readers. */
  heading?: boolean;
}

/** The only way text is drawn in the kit: a variant for size and face, a tone for colour. */
export function AppText({ variant = "body", tone = "text", align, heading, style, ...rest }: AppTextProps) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole={heading ? "header" : undefined}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[textStyles[variant], { color: colors[tone], textAlign: align }, style]}
      {...rest}
    />
  );
}
