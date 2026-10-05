import { Pressable, Text, View } from "react-native";
import { LOCALES, type Locale } from "@tarragon/i18n";
import { ta } from "@/lib/auth/auth-locale";
import { usePidginEnabled } from "@/lib/pidgin-switch";
import { colors, inkAlpha, radius } from "@/ui/theme";

/** Small English | Pidgin switch for the signed-out screens. */
export function LanguageChooser({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (next: Locale) => void;
}) {
  // Pidgin switched off platform-wide: English only, nothing to choose.
  if (!usePidginEnabled()) return null;
  return (
    <View
      accessibilityLabel={ta("auth.language.title", locale)}
      style={{
        flexDirection: "row",
        alignSelf: "center",
        backgroundColor: inkAlpha(0.05),
        borderRadius: radius.control,
        padding: 4,
        gap: 4,
      }}
    >
      {LOCALES.map((l) => (
        <Pressable
          key={l}
          accessibilityRole="button"
          accessibilityState={{ selected: locale === l }}
          onPress={() => onChange(l)}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 14,
            borderRadius: radius.control - 2,
            backgroundColor: locale === l ? colors.card : "transparent",
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: locale === l ? colors.ink : colors.muted }}>
            {ta(l === "en" ? "auth.language.en" : "auth.language.pcm", locale)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
