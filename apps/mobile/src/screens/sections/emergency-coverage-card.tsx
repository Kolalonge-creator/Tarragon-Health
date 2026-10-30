import { useState } from "react";
import { TextInput, View } from "react-native";
import { t } from "@tarragon/i18n";
import { saveEmergencyCoverage, type EmergencyFacts } from "@/lib/emergency";
import { useLegacyColors, textStyles } from "@/ui/design";
import { Card, ChoiceChip, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";
import { AppText } from "@/ui/kit";

/**
 * Optional HMO / NHIA cover for the emergency card (S09y). Typed by the person, shown on the card only once filled in, patient entered and unchecked,
 * never on the lock-screen card. Saving goes through the one database function; the card is reloaded by the caller afterwards.
 */
export function EmergencyCoverageCard({ initial, onChanged }: { initial: EmergencyFacts["coverage"]; onChanged: () => void }) {
  const colors = useLegacyColors();
  const [scheme, setScheme] = useState<"hmo" | "nhia">(initial?.scheme ?? "hmo");
  const [memberNumber, setMemberNumber] = useState(initial?.member_number ?? "");
  const [planName, setPlanName] = useState(initial?.plan_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const inputStyle = { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, color: colors.ink, ...textStyles.bodyLarge } as const;

  async function save(clear: boolean) {
    setSaving(true);
    setError(null);
    setMessage(null);
    const result = await saveEmergencyCoverage({ scheme, memberNumber: clear ? "" : memberNumber, planName: clear ? "" : planName });
    setSaving(false);
    if (!result.ok) {
      setError(result.field === "member_number" ? t("ecf.coverage.error_member") : result.field === "plan_name" ? t("ecf.coverage.error_plan") : t("ecf.coverage.error"));
      return;
    }
    if (clear) {
      setMemberNumber("");
      setPlanName("");
    }
    setMessage(result.removed ? t("ecf.coverage.removed") : t("ecf.coverage.saved"));
    onChanged();
  }

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="bodyLargeStrong">{t("ecf.coverage.title")}</AppText>
      <MutedText>{t("ecf.coverage.description")}</MutedText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <ChoiceChip selected={scheme === "hmo"} title={`${scheme === "hmo" ? "✓ " : ""}${t("ecf.coverage.scheme_hmo")}`} onPress={() => setScheme("hmo")} />
        <ChoiceChip selected={scheme === "nhia"} title={`${scheme === "nhia" ? "✓ " : ""}${t("ecf.coverage.scheme_nhia")}`} onPress={() => setScheme("nhia")} />
      </View>
      <TextInput
        accessibilityLabel={t("ecf.coverage.member_label")}
        placeholder={t("ecf.coverage.member_label")}
        placeholderTextColor={colors.muted}
        value={memberNumber}
        onChangeText={setMemberNumber}
        maxLength={40}
        autoCapitalize="characters"
        autoCorrect={false}
        style={inputStyle}
      />
      <TextInput
        accessibilityLabel={t("ecf.coverage.plan_label")}
        placeholder={t("ecf.coverage.plan_label")}
        placeholderTextColor={colors.muted}
        value={planName}
        onChangeText={setPlanName}
        maxLength={80}
        style={inputStyle}
      />
      <MutedText>{t("ecf.coverage.lock_screen_note")}</MutedText>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {message ? <MutedText>{message}</MutedText> : null}
      <PrimaryButton title={t("ecf.coverage.save")} onPress={() => void save(false)} loading={saving} disabled={memberNumber.trim() === "" && planName.trim() === ""} />
      {initial ? <SecondaryButton title={t("ecf.coverage.clear")} onPress={() => void save(true)} disabled={saving} /> : null}
    </Card>
  );
}
