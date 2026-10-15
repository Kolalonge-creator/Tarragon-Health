import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { isValidSharedPhonePin } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { useSharedPhone } from "@/lib/shared-phone";
import { radius } from "@/ui/theme";
import { useLegacyColors, useTextInputStyle, useTheme, placeholderColorFor } from "@/ui/design";
import { Card, MutedText, PrimaryButton, SecondaryButton } from "@/ui/legacy-kit";

/** Replaces the wellbeing content while it is hidden. Names nothing about what it hides. */
export function HiddenCard() {
  const { hasPin, show } = useSharedPhone();
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("mood.shared.gate_title")}</Text>
      <MutedText>{t("mood.shared.gate_body")}</MutedText>
      {hasPin && (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, color: colors.ink }}>{t("mood.shared.gate_pin")}</Text>
          <TextInput
            keyboardAppearance={scheme}
            placeholderTextColor={placeholderColorFor(scheme)}
            value={pin}
            onChangeText={(v) => { setPin(v.replace(/\D/g, "").slice(0, 8)); setWrong(false); }}
            keyboardType="number-pad"
            secureTextEntry
            accessibilityLabel={t("mood.shared.gate_pin")}
            style={[textInputStyle, { width: 120 }]}
          />
          {wrong && <Text accessibilityRole="alert" style={{ fontSize: 12, color: colors.status.critical }}>{t("mood.shared.gate_wrong")}</Text>}
        </View>
      )}
      <PrimaryButton
        title={t("mood.shared.gate_show")}
        onPress={async () => { const ok = await show(pin); if (!ok) setWrong(true); else setPin(""); }}
      />
    </Card>
  );
}

/** The switch, the optional PIN and Hide now. */
export function SharedPhoneSettings() {
  const { on, hasPin, hidden, setOn, setPin, clearPin, hideNow } = useSharedPhone();
  const colors = useLegacyColors();
  const textInputStyle = useTextInputStyle();
  const { scheme } = useTheme();
  const [pin, setPinText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>{t("mood.shared.title")}</Text>
      <MutedText>{t("mood.shared.body")}</MutedText>
      <Text onPress={() => void setOn(!on)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ fontSize: 13, color: colors.ink }}>
        <Text style={{ fontWeight: "700" }}>{on ? "[x] " : "[ ] "}</Text>
        {t("mood.shared.keep_hidden")}
      </Text>
      <Text style={{ fontSize: 12, color: colors.ink }}>{hasPin ? t("mood.shared.pin_change") : t("mood.shared.pin_new")}</Text>
      <TextInput
        keyboardAppearance={scheme}
        placeholderTextColor={placeholderColorFor(scheme)}
        value={pin}
        onChangeText={(v) => setPinText(v.replace(/\D/g, "").slice(0, 8))}
        keyboardType="number-pad"
        secureTextEntry
        accessibilityLabel={t("mood.shared.pin_new")}
        style={[textInputStyle, { width: 120, borderRadius: radius.control }]}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <SecondaryButton
          title={t("mood.shared.save_pin")}
          onPress={async () => {
            if (!isValidSharedPhonePin(pin)) return setMessage(t("mood.shared.pin_invalid"));
            setMessage((await setPin(pin)) ? t("mood.shared.pin_saved") : t("mood.shared.pin_failed"));
            setPinText("");
          }}
        />
        {hasPin && <SecondaryButton title={t("mood.shared.remove_pin")} onPress={async () => { await clearPin(); setMessage(t("mood.shared.pin_removed")); }} />}
        {!hidden && <PrimaryButton title={t("mood.shared.hide_now")} onPress={hideNow} />}
      </View>
      {message && <Text accessibilityRole="alert" style={{ fontSize: 12, color: colors.ink }}>{message}</Text>}
      <MutedText>{t("mood.shared.pin_note")}</MutedText>
    </Card>
  );
}
