import { useState } from "react";
import { View } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { BP_CHECKLIST_SYMPTOMS, type BpChecklistSymptom } from "@/lib/bp-checklist";
import type { HomeProtocolConfig } from "@/lib/s07-config";
import { MIN_TARGET, radii, space, useTheme } from "@/ui/design";
import { AppText, Button, Icon, PressableScale } from "@/ui/kit";

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * The guided technique steps shown beside the blood pressure fields (HLP-003).
 * Collapsed by default so the quick log stays two taps away; every number in
 * the wording comes from the versioned protocol config, never from the text.
 * The wording is a general guide and carries the line that the care team may
 * advise otherwise.
 */
export function TechniqueGuide({ tr, protocol }: { tr: Tr; protocol: HomeProtocolConfig }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const steps: { key: MessageKey; params?: Record<string, number> }[] = [
    { key: "vitals.technique.step_sit" },
    { key: "vitals.technique.step_rest", params: { minutes: protocol.restMinutes } },
    { key: "vitals.technique.step_avoid", params: { minutes: protocol.avoidBeforeMinutes } },
    { key: "vitals.technique.step_arm" },
    { key: "vitals.technique.step_still" },
    { key: "vitals.technique.step_repeat", params: { gap: protocol.minGapMinutes } },
  ];
  return (
    <View style={{ gap: space.sm }}>
      <Button
        variant="secondary"
        fullWidth={false}
        title={open ? tr("vitals.technique.hide") : tr("vitals.technique.toggle")}
        onPress={() => setOpen((v) => !v)}
      />
      {open ? (
        <View
          accessibilityLabel={tr("vitals.technique.title")}
          style={{ gap: space.sm, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted }}
        >
          <AppText variant="bodyStrong" heading>
            {tr("vitals.technique.title")}
          </AppText>
          {steps.map((s, i) => (
            <View key={s.key} style={{ flexDirection: "row", gap: space.sm }}>
              <AppText variant="bodyStrong" tone="textMuted">
                {i + 1}.
              </AppText>
              <View style={{ flex: 1 }}>
                <AppText variant="body">{tr(s.key, s.params)}</AppText>
              </View>
            </View>
          ))}
          <AppText variant="caption" tone="textMuted">
            {tr("vitals.technique.footer")}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Optional symptom ticks. Checked state is shown by a tick icon and by the
 * accessibility state, never by colour alone. Ticking does not rate anything:
 * the planner records a tick at the configured severity with a note saying so.
 * The weakness, numbness and speech line is static guidance, because that
 * symptom has no symptom type to log against.
 */
export function SymptomChecklist({
  tr,
  selected,
  onToggle,
}: {
  tr: Tr;
  selected: readonly BpChecklistSymptom[];
  onToggle: (s: BpChecklistSymptom) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="bodyStrong" heading>
        {tr("vitals.symptoms.title")}
      </AppText>
      <AppText variant="caption" tone="textMuted">
        {tr("vitals.symptoms.hint")}
      </AppText>
      <View accessibilityLabel={tr("vitals.symptoms.group")} style={{ gap: space.xs }}>
        {BP_CHECKLIST_SYMPTOMS.map((s) => {
          const checked = selected.includes(s);
          return (
            <PressableScale
              key={s}
              onPress={() => onToggle(s)}
              accessibilityRole="checkbox"
              accessibilityLabel={tr(`vitals.symptom.${s}` as MessageKey)}
              accessibilityState={{ checked }}
              scaleTo={0.98}
              style={{
                minHeight: MIN_TARGET,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: space.md,
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
              <View style={{ flex: 1 }}>
                <AppText variant="body">{tr(`vitals.symptom.${s}` as MessageKey)}</AppText>
              </View>
            </PressableScale>
          );
        })}
      </View>
      <AppText variant="caption" tone="textMuted">
        {tr("vitals.symptoms.more_help")}
      </AppText>
    </View>
  );
}
