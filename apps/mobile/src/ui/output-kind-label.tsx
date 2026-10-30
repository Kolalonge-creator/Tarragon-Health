import { Text, View } from "react-native";
import { asLocale, OUTPUT_KIND_KEYS, outputKindHintKey, t, type OutputAudience, type OutputKind } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { useLegacyColors, textStyles } from "@/ui/design";

/**
 * The phone's copy of the one label for what kind of output this is (automated information, reviewed by the care team, or a clinician
 * decision). Same words as the web component, from the same definition in packages/i18n, so a person learns them once. The words carry
 * the meaning, not the colour. `note` keeps a screen's own specific caveat beside the label.
 */
export function OutputKindLabel({ kind, note, audience = "patient" }: { kind: OutputKind; note?: string; audience?: OutputAudience }) {
  const colors = useLegacyColors();
  const locale = asLocale(useUiLanguage());
  const keys = OUTPUT_KIND_KEYS[kind];
  const label = t(keys.label, locale);
  const hint = t(outputKindHintKey(kind, audience), locale);
  return (
    <View accessible accessibilityLabel={`${label}. ${note ? `${note}. ` : ""}${hint}`} style={{ gap: 2 }}>
      <Text style={{ ...textStyles.label, color: colors.ink }}>{label}</Text>
      {note ? <Text style={{ ...textStyles.caption, color: colors.ink }}>{note}</Text> : null}
    </View>
  );
}
