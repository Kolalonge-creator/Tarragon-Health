import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { t } from "@tarragon/i18n";
import { loadGlucoseResponse, GLUCOSE_RESPONSE_MIN_PAIRS, type GlucoseResponseResult } from "@/lib/glucose-response";
import { typeScale } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Card, MutedText, SectionLabel } from "@/ui/legacy-kit";

/**
 * Personal glucose-response insights (S50b, 6.11), native. Ranges and sample counts only: no ranking, no score, no colour on a food, and never a
 * sentence that says a food caused a change. Nothing shows while the go-live guard is off, or for anyone the nutrition rules withhold targets from.
 */
export function GlucoseResponseCard() {
  const colors = useLegacyColors();
  const [result, setResult] = useState<GlucoseResponseResult | null>(null);

  useEffect(() => {
    let live = true;
    void loadGlucoseResponse()
      .then((r) => live && setResult(r))
      .catch(() => live && setResult({ state: "unavailable" }));
    return () => {
      live = false;
    };
  }, []);

  if (!result || result.state === "unavailable") return null;
  const { summary, rows } = result;

  return (
    <Card style={{ gap: 10 }}>
      <SectionLabel>{t("glucose.response.title")}</SectionLabel>
      <MutedText>{t("glucose.response.intro")}</MutedText>
      <MutedText>{t("glucose.response.counts", "en", { paired: summary.pairedMeals, meals: summary.mealsConsidered })}</MutedText>
      {!summary.enoughData ? (
        <Text style={{ fontSize: typeScale.body, color: colors.ink }}>{t("glucose.response.not_enough", "en", { n: GLUCOSE_RESPONSE_MIN_PAIRS })}</Text>
      ) : (
        rows.map((r) => (
          <View key={r.key} style={{ gap: 2 }}>
            <Text style={{ fontSize: typeScale.body, fontWeight: "600", color: colors.ink }}>{r.key === "all" ? t("glucose.response.all") : r.label}</Text>
            <Text style={{ fontSize: typeScale.body, color: colors.ink }}>
              {r.key === "all"
                ? t("glucose.response.row_all", "en", { after: r.after, before: r.before, n: r.n })
                : t("glucose.response.row", "en", { food: r.label, after: r.after, before: r.before, n: r.n })}
            </Text>
            <MutedText>{t("glucose.response.change", "en", { change: r.change })}</MutedText>
          </View>
        ))
      )}
      <MutedText>{t("glucose.response.disclaimer")}</MutedText>
    </Card>
  );
}
