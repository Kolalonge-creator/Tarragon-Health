import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { elevation, radii, space, useTheme } from "../design";

interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  level?: 0 | 1 | 2;
  padded?: boolean;
}

/** A white (or dark) card on the canvas: border in both schemes, a soft shadow only in light. */
export function Card({ children, style, level = 1, padded = true }: CardProps) {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: padded ? space.lg : 0,
        },
        elevation(scheme, level),
        style,
      ]}
    >
      {children}
    </View>
  );
}
