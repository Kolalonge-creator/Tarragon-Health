import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { PLACE_LABEL_MAX } from "@tarragon/shared";
import { MIN_TARGET, radii, space, useTheme } from "@/ui/design";
import { AppText, Field, Icon, PressableScale } from "@/ui/kit";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * A tick row: checked state is shown by a tick icon and by the accessibility state, never by colour alone (the same look as the symptom ticks).
 */
export function TickRow({ label, hint, checked, onToggle }: { label: string; hint?: string; checked: boolean; onToggle: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked }}
      scaleTo={0.98}
      style={{
        minHeight: MIN_TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: checked ? colors.brand : colors.border,
        backgroundColor: checked ? colors.surfaceMuted : colors.surface,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radii.sm,
          borderWidth: 2,
          borderColor: checked ? colors.brand : colors.border,
          backgroundColor: checked ? colors.brand : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Icon name="done" size={16} tone="textOnBrand" /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body">{label}</AppText>
        {hint ? (
          <AppText variant="caption" tone="textMuted">
            {hint}
          </AppText>
        ) : null}
      </View>
    </PressableScale>
  );
}

/**
 * "This was taken at a pharmacy or clinic machine" (S07y). Offered only while the server's pharmacy_bp_readings guard is open for the person. Ticking it
 * changes nothing about how the reading is checked or what happens to a dangerous value; it only keeps the reading out of the home average, and the place is
 * optional and only for the person's own memory.
 */
export function PharmacyTick({
  tr,
  checked,
  onChange,
  place,
  onPlace,
}: {
  tr: Tr;
  checked: boolean;
  onChange: (next: boolean) => void;
  place: string;
  onPlace: (next: string) => void;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <TickRow label={tr("pharm.tick")} hint={tr("pharm.tick_hint")} checked={checked} onToggle={() => onChange(!checked)} />
      {checked ? <Field label={tr("pharm.place")} hint={tr("pharm.place_hint")} value={place} onChangeText={onPlace} maxLength={PLACE_LABEL_MAX} /> : null}
    </View>
  );
}
