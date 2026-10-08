import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { t, type MessageKey } from "@tarragon/i18n";
import { grantFeatureConsent, loadFeatureConsentOn, type FeatureConsentType } from "@/lib/feature-consent";
import { spacing } from "@/ui/theme";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/legacy-kit";

/**
 * S47d: shows its children only once the person has said yes to this feature (reproductive health, mental health or device data). Otherwise it asks, in plain
 * words. "Not now" saves nothing and the feature stays off. The database refuses the write without the yes, so this is the friendly half of a rule that holds
 * even if this screen is skipped. A failed lookup is treated as "no". Wording is a placeholder pending counsel.
 *
 * `title` makes the gate a whole-screen gate (it renders its own scroll view with that title); without it the prompt is a card in place of the children.
 */
export function FeatureConsentGate({ dataType, title, children }: { dataType: FeatureConsentType; title?: string; children: ReactNode }) {
  const colors = useLegacyColors();
  const [state, setState] = useState<"loading" | "on" | "off">("loading");
  const [declined, setDeclined] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadFeatureConsentOn(dataType).then((on) => {
      if (live) setState(on ? "on" : "off");
    });
    return () => {
      live = false;
    };
  }, [dataType]);

  const allow = useCallback(async () => {
    setSaving(true);
    setError(null);
    const res = await grantFeatureConsent(dataType);
    setSaving(false);
    if (res.ok) setState("on");
    else setError(res.error);
  }, [dataType]);

  if (state === "on") return <>{children}</>;
  if (state === "loading") {
    return (
      <View style={{ padding: spacing.screen, alignItems: "center" }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const prompt = (
    <Card style={{ gap: 10 }}>
      {declined ? (
        <MutedText>{t("consent.feature.declined")}</MutedText>
      ) : (
        <>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>{t("consent.feature.ask_title")}</Text>
          <MutedText>{t(`consent.feature.${dataType}.ask` as MessageKey)}</MutedText>
          <MutedText>{t("consent.matrix.off_stops_feature_only")}</MutedText>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton title={t("consent.feature.ask_allow")} onPress={allow} loading={saving} disabled={saving} />
          <SecondaryButton title={t("consent.feature.ask_not_now")} onPress={() => setDeclined(true)} disabled={saving} />
        </>
      )}
    </Card>
  );
  if (!title) return prompt;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 16 }}>
      <ScreenTitle>{title}</ScreenTitle>
      {prompt}
    </ScrollView>
  );
}
