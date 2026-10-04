import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { Locale } from "@tarragon/i18n";
import { maskPhone } from "@tarragon/auth/phone";
import { supabase } from "@/lib/supabase";
import { ta } from "@/lib/auth/auth-locale";
import {
  isOtpComplete,
  requestPhoneCode,
  resendPhoneCode,
  sanitiseOtp,
  verifyPhoneCode,
  OTP_LENGTH,
} from "@/lib/auth/auth-flow";
import { useResendCountdown } from "@/lib/auth/use-resend-countdown";
import { colors, radius } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton } from "@/ui/components";

/**
 * 6-digit SMS code entry, shared by phone sign-up and "phone not confirmed"
 * sign-in. The account is unusable until verifyOtp succeeds (the server
 * enforces that); on success Supabase creates the session and App.tsx's
 * auth listener takes over, so this screen never navigates on its own.
 */
export function VerifyCodeStep({
  phone,
  locale,
  notice,
  kind = "confirm",
  onBack,
}: {
  phone: string;
  locale: Locale;
  /** e.g. the "still needs confirming" notice after a sign-in attempt. */
  notice?: string;
  /** "confirm": finishing sign-up. "signin": code sign-in for a confirmed number (resend uses a fresh sign-in code). */
  kind?: "confirm" | "signin";
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const { seconds, restart } = useResendCountdown();

  async function confirm() {
    setError(null);
    if (!isOtpComplete(code)) {
      setError(ta("auth.error.wrong_code", locale));
      return;
    }
    setLoading(true);
    const outcome = await verifyPhoneCode(supabase.auth, { phone, code });
    setLoading(false);
    if (outcome.kind === "error") setError(ta(outcome.key, locale));
  }

  async function resend() {
    if (seconds > 0 || resending) return;
    setError(null);
    setResending(true);
    const outcome =
      kind === "signin"
        ? await requestPhoneCode(supabase.auth, phone)
        : await resendPhoneCode(supabase.auth, phone);
    setResending(false);
    if (outcome.kind === "error") {
      setError(ta(outcome.key, locale));
      return;
    }
    restart();
    setCode("");
  }

  return (
    <View style={{ gap: 12 }}>
      <View>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>
          {ta("auth.verify.title", locale)}
        </Text>
        <MutedText>{ta("auth.verify.sent", locale, { phone: maskPhone(phone) })}</MutedText>
      </View>
      {notice ? <MutedText>{notice}</MutedText> : null}
      <TextInput
        accessibilityLabel={ta("auth.field.code", locale)}
        placeholder={ta("auth.field.code", locale)}
        placeholderTextColor={colors.subtle}
        keyboardType="number-pad"
        // Lets the OS offer the code from the incoming SMS.
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={OTP_LENGTH + 4}
        value={code}
        // Paste-friendly: "123 456" or "123-456" is cleaned to digits.
        onChangeText={(v) => setCode(sanitiseOtp(v))}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.control,
          padding: 14,
          fontSize: 22,
          letterSpacing: 6,
          textAlign: "center",
          color: colors.ink,
          backgroundColor: colors.card,
        }}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <PrimaryButton
        title={loading ? ta("auth.verify.submitting", locale) : ta("auth.verify.submit", locale)}
        onPress={confirm}
        loading={loading}
        disabled={!isOtpComplete(code)}
      />
      {seconds > 0 ? (
        <Text style={{ textAlign: "center", color: colors.muted, fontSize: 14 }}>
          {ta("auth.verify.resend_in", locale, { seconds })}
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => void resend()}
          disabled={resending}
          style={{ alignItems: "center", paddingVertical: 4 }}
        >
          <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "600" }}>
            {ta("auth.verify.resend", locale)}
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        style={{ alignItems: "center", paddingVertical: 4 }}
      >
        <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "600" }}>
          {ta("auth.verify.wrong_number", locale)}
        </Text>
      </Pressable>
    </View>
  );
}
