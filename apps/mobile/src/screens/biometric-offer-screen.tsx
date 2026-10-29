import { useState } from "react";
import { Modal, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ta } from "@/lib/auth/auth-locale";
import { acceptBiometricOffer, declineBiometricOffer } from "@/lib/auth/biometric-offer";
import { useUiLanguage } from "@/lib/ui-language";
import { colors, inkAlpha, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

/**
 * One-time offer shown after the first sign-in on a device that has
 * biometrics or a device credential set up (App.tsx decides when).
 * "Turn on" proves the unlock works before enabling; "Not now" is remembered
 * so the offer never returns. Settings keeps the off switch.
 */
export function BiometricOfferScreen({ onDone }: { onDone: () => void }) {
  const locale = useUiLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enable() {
    setBusy(true);
    setError(null);
    const answer = await acceptBiometricOffer(ta("auth.biometric.offer_title", locale));
    setBusy(false);
    if (answer === "failed") {
      setError(ta("auth.error.generic", locale));
      return;
    }
    if (answer === "unavailable") {
      setError(ta("auth.biometric.unavailable", locale));
      return;
    }
    onDone();
  }

  async function notNow() {
    await declineBiometricOffer();
    onDone();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void notNow()}>
      <View
        style={{ flex: 1, backgroundColor: inkAlpha(0.4), justifyContent: "center", padding: spacing.screen }}
      >
        <View
          style={{ backgroundColor: colors.card, borderRadius: radius.card, padding: 20, gap: 12 }}
        >
          <View style={{ alignItems: "center" }}>
            <Ionicons name="finger-print" size={36} color={colors.brand} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.ink, textAlign: "center" }}>
            {ta("auth.biometric.offer_title", locale)}
          </Text>
          <MutedText>{ta("auth.biometric.offer_body", locale)}</MutedText>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton title={ta("auth.biometric.enable", locale)} onPress={enable} loading={busy} />
          <SecondaryButton title={ta("auth.biometric.not_now", locale)} onPress={() => void notNow()} />
        </View>
      </View>
    </Modal>
  );
}
