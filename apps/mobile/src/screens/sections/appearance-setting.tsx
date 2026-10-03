import { Pressable, Text, View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { DARK_MODE_ENABLED, useTheme, type SchemePreference } from "@/ui/design";
import { colors, radius } from "@/ui/theme";
import { MutedText, SectionLabel } from "@/ui/components";

const CHOICES: { value: SchemePreference; label: "appearance.light" | "appearance.dark" }[] = [
  { value: "light", label: "appearance.light" },
  { value: "dark", label: "appearance.dark" },
];

/**
 * Light or Dark. Drawn with the legacy light colours on purpose: Settings is still a
 * light screen, and this is the control that gets a patient back out of Dark, so it
 * must read the same in both schemes. Light is the default and nothing changes for
 * anyone who never opens this.
 */
export function AppearanceSetting() {
  const { preference, setPreference } = useTheme();
  const locale = asLocale(useUiLanguage());
  if (!DARK_MODE_ENABLED) return null;
  // A stored "system" (never offered) reads as Light.
  const selected: SchemePreference = preference === "dark" ? "dark" : "light";

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{t("appearance.title", locale)}</SectionLabel>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("appearance.title", locale)}
        style={{ flexDirection: "row", gap: 10 }}
      >
        {CHOICES.map((choice) => {
          const active = choice.value === selected;
          return (
            <Pressable
              key={choice.value}
              accessibilityRole="radio"
              accessibilityLabel={t(choice.label, locale)}
              accessibilityState={{ selected: active, checked: active }}
              onPress={() => setPreference(choice.value)}
              style={{
                flex: 1,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: active ? colors.brand : colors.border,
                backgroundColor: active ? colors.brand : colors.card,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "600", color: active ? "#FFFFFF" : colors.ink }}>
                {t(choice.label, locale)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <MutedText>{t("appearance.note", locale)}</MutedText>
    </View>
  );
}
