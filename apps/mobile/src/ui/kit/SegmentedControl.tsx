import { View } from "react-native";
import { MIN_TARGET, radii, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { PressableScale } from "./PressableScale";

interface SegmentedControlProps<T extends string | number> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}

/** Two to four mutually exclusive views, such as 7 days or 30 days. */
export function SegmentedControl<T extends string | number>({ options, value, onChange, accessibilityLabel }: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: "row", backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: space.xxs, gap: space.xxs }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected }}
            scaleTo={0.98}
            style={{
              flex: 1,
              minHeight: MIN_TARGET,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radii.md - 2,
              backgroundColor: selected ? colors.surface : "transparent",
              borderWidth: selected ? 1 : 0,
              borderColor: colors.border,
            }}
          >
            <AppText variant="label" tone={selected ? "text" : "textMuted"}>
              {option.label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}
