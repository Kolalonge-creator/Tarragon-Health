import { MIN_TARGET, radii, space, useTheme } from "../design";
import { AppText } from "./AppText";
import { PressableScale } from "./PressableScale";

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Spoken label when the visible one is short ("Fasting" becomes "Fasting glucose reading"). */
  accessibilityLabel?: string;
}

/** A choice chip in a group (radio semantics). Selected is shown by fill AND by the accessibility state. */
export function Chip({ label, selected, onPress, accessibilityLabel }: ChipProps) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, checked: selected }}
      scaleTo={0.96}
      style={{
        minHeight: MIN_TARGET,
        justifyContent: "center",
        paddingHorizontal: space.lg,
        borderRadius: radii.pill,
        backgroundColor: selected ? colors.brand : colors.surfaceMuted,
        borderWidth: 1,
        borderColor: selected ? colors.brand : colors.border,
      }}
    >
      <AppText variant="label" tone={selected ? "textOnBrand" : "text"}>
        {label}
      </AppText>
    </PressableScale>
  );
}
