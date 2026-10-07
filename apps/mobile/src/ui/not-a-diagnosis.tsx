import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { useLegacyColors } from "./design";
import { radius } from "./theme";

/**
 * The one "not a diagnosis" label on the phone (S60, spec 12.9): the words come from packages/i18n (`symptom.not_a_diagnosis.*`),
 * the same keys the web component uses. Every mobile symptom result surface renders this and never its own sentence.
 */
export function NotADiagnosis({ variant = "full" }: { variant?: "full" | "short" }) {
  const colors = useLegacyColors();
  return (
    <View accessibilityRole="text" testID="not-a-diagnosis" style={{ borderRadius: radius.control, padding: 10, backgroundColor: colors.groupBg }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{t(variant === "short" ? "symptom.not_a_diagnosis.short" : "symptom.not_a_diagnosis.full")}</Text>
    </View>
  );
}
