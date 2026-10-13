import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { normalisePhoneWithCountry } from "@tarragon/auth/phone";
import { supabase } from "@/lib/supabase";
import { ta } from "@/lib/auth/auth-locale";
import {
  authErrorKey,
  isOtpComplete,
  requestPhoneCode,
  sanitiseOtp,
  verifyPhoneCode,
} from "@/lib/auth/auth-flow";
import { checkNewPassword } from "@/lib/auth/password-verdict";
import { DEFAULT_LOCALE } from "@tarragon/i18n";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, inkAlpha, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

type Tab = "phone" | "email";
type PhoneStep = "request" | "verify" | "new-password";

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.control,
  padding: 14,
  fontSize: 16,
  color: colors.ink,
  backgroundColor: colors.card,
} as const;

/** Supabase auth error strings are developer-facing; map them to warm plain language. */
function friendlyPasswordUpdateError(rawMessage: string): string {
  const message = rawMessage.toLowerCase();
  if (message.includes("different from the old")) {
    return "That's the same as your current password. Choose a new one.";
  }
  if (message.includes("weak") || (message.includes("password") && message.includes("at least"))) {
    return "That password is too easy to guess. Try a longer one with a mix of letters and numbers.";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return "We couldn't update your password just now. Please try again.";
}

/** Same show/hide affordance as login-screen.tsx's password field. */
function PasswordField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ justifyContent: "center" }}>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        secureTextEntry={!visible}
        value={value}
        onChangeText={onChangeText}
        style={[inputStyle, { paddingRight: 44 }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? "Hide password" : "Show password"}
        onPress={() => setVisible((v) => !v)}
        style={{ position: "absolute", right: 12, height: "100%", justifyContent: "center" }}
      >
        <Ionicons name={visible ? "eye-off" : "eye"} size={20} color={colors.faint} />
      </Pressable>
    </View>
  );
}

/**
 * Native forgot/reset-password (spec §1). Phone is the primary path — it
 * reuses the same signInWithOtp/verifyOtp calls as web phone login
 * (forgot-password/actions.ts), which establishes a real session natively
 * with no deep link needed, then calls auth.updateUser() directly. Email
 * intentionally stops at "check your email" rather than trying to catch the
 * recovery link natively: the web reset flow uses a URL-fragment + PKCE
 * exchange that's browser-specific (see the fragment-bug memory) and there's
 * no verified Supabase Auth redirect-URL entry for a native deep link yet —
 * the emailed link still opens and completes fine in the device browser.
 */
export function ForgotPasswordScreen({ onClose }: { onClose: () => void }) {
  const locale = DEFAULT_LOCALE;
  const [tab, setTab] = useState<Tab>("phone");
  // E.164 number the code was (apparently) sent to. Same screen whether or
  // not the number is registered: recovery never reveals who has an account.
  const [recoveryPhone, setRecoveryPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [countryCode, setCountryCode] = useState<string>(COUNTRY_CALLING_CODES[0].dialCode);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [localPhone, setLocalPhone] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("request");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  async function sendPhoneCode() {
    setError(null);
    const phone = normalisePhoneWithCountry(countryCode, localPhone);
    if (!phone.ok) {
      setError(ta("auth.error.invalid_phone", locale));
      return;
    }
    setLoading(true);
    // shouldCreateUser:false + unknown-user treated as sent (see requestPhoneCode).
    const outcome = await requestPhoneCode(supabase.auth, phone.e164);
    setLoading(false);
    if (outcome.kind === "error") {
      setError(ta(outcome.key, locale));
      return;
    }
    setRecoveryPhone(phone.e164);
    setPhoneStep("verify");
  }

  async function verifyCode() {
    setError(null);
    if (!recoveryPhone || !isOtpComplete(otp)) {
      setError(ta("auth.error.wrong_code", locale));
      return;
    }
    setLoading(true);
    const outcome = await verifyPhoneCode(supabase.auth, { phone: recoveryPhone, code: otp });
    setLoading(false);
    if (outcome.kind === "error") {
      setError(ta(outcome.key, locale));
      return;
    }
    setPhoneStep("new-password");
  }

  async function submitNewPassword() {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(ta("auth.password.mismatch", locale));
      return;
    }
    setLoading(true);
    const pwCheck = await checkNewPassword(newPassword);
    if (!pwCheck.ok) {
      setLoading(false);
      setError(ta(pwCheck.key, locale, { min: 8 }));
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (updateError) {
      setError(friendlyPasswordUpdateError(updateError.message));
      return;
    }
    // The OTP verify above already signed this device in — App.tsx's
    // auth-state listener takes over from here, so just close the modal.
    onClose();
  }

  async function sendEmailLink() {
    setError(null);
    setLoading(true);
    // Supabase never reveals whether the email is registered — this
    // "succeeds" for an unknown address too, matching web's anti-enumeration
    // behaviour (forgot-password/actions.ts's requestPasswordResetEmail).
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${PLATFORM_URL}/reset-password`,
    });
    setLoading(false);
    if (resetError) {
      setError(ta(authErrorKey(resetError.message, "recovery"), locale));
      return;
    }
    setEmailSent(true);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingTop: 56, gap: 16 }}>
        <SecondaryButton title="Close" onPress={onClose} />

        <View>
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.ink }}>
            {ta("auth.recovery.title", locale)}
          </Text>
          <MutedText>We can text you a code, or email you a reset link.</MutedText>
        </View>

        <View
          style={{
            flexDirection: "row",
            backgroundColor: inkAlpha(0.05),
            borderRadius: radius.control,
            padding: 4,
            gap: 4,
          }}
        >
          <TabButton
            label="Phone"
            active={tab === "phone"}
            onPress={() => {
              setTab("phone");
              setError(null);
            }}
          />
          <TabButton
            label="Email"
            active={tab === "email"}
            onPress={() => {
              setTab("email");
              setError(null);
            }}
          />
        </View>

        {tab === "phone" ? (
          <View style={{ gap: 10 }}>
            {phoneStep === "request" ? (
              <>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Country code ${countryCode}. Opens the country list.`}
                    onPress={() => setCountryPickerOpen(true)}
                    style={[inputStyle, { width: 92, justifyContent: "center" }]}
                  >
                    <Text style={{ fontSize: 16, color: colors.ink }}>{countryCode}</Text>
                  </Pressable>
                  <TextInput
                    accessibilityLabel="Phone number"
                    placeholder="XXXXXXXXXX"
                    placeholderTextColor={colors.subtle}
                    keyboardType="phone-pad"
                    value={localPhone}
                    onChangeText={setLocalPhone}
                    style={[inputStyle, { flex: 1 }]}
                  />
                </View>
                {error ? <ErrorText>{error}</ErrorText> : null}
                <PrimaryButton title={ta("auth.signin.send_code", locale)} onPress={sendPhoneCode} loading={loading} />
              </>
            ) : phoneStep === "verify" ? (
              <>
                <MutedText>{ta("auth.recovery.sent_generic", locale)}</MutedText>
                <TextInput
                  accessibilityLabel={ta("auth.field.code", locale)}
                  placeholder={ta("auth.field.code", locale)}
                  placeholderTextColor={colors.subtle}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={10}
                  value={otp}
                  onChangeText={(v) => setOtp(sanitiseOtp(v))}
                  style={inputStyle}
                />
                {error ? <ErrorText>{error}</ErrorText> : null}
                <PrimaryButton title={ta("auth.verify.submit", locale)} onPress={verifyCode} loading={loading} />
                <SecondaryButton
                  title={ta("auth.verify.wrong_number", locale)}
                  onPress={() => {
                    setPhoneStep("request");
                    setOtp("");
                    setError(null);
                  }}
                />
              </>
            ) : (
              <>
                <MutedText>{ta("auth.recovery.set_password", locale)}</MutedText>
                <PasswordField
                  accessibilityLabel="New password"
                  placeholder="New password"
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                <PasswordField
                  accessibilityLabel="Confirm new password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                />
                {error ? <ErrorText>{error}</ErrorText> : null}
                <PrimaryButton
                  title="Update password"
                  onPress={submitNewPassword}
                  loading={loading}
                />
              </>
            )}
          </View>
        ) : emailSent ? (
          <MutedText>{ta("auth.recovery.sent_generic", locale)}</MutedText>
        ) : (
          <View style={{ gap: 10 }}>
            <TextInput
              accessibilityLabel="Email"
              placeholder="Email"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              style={inputStyle}
            />
            {error ? <ErrorText>{error}</ErrorText> : null}
            <PrimaryButton title="Send reset link" onPress={sendEmailLink} loading={loading} />
          </View>
        )}
      </ScrollView>

      <Modal
        visible={countryPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <Pressable accessible={false}
          onPress={() => setCountryPickerOpen(false)}
          style={{ flex: 1, backgroundColor: inkAlpha(0.4), justifyContent: "flex-end" }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              // Scrolls rather than growing unbounded — on a small phone the
              // full country list would otherwise render past the screen with
              // no way to reach the bottom entries.
              maxHeight: "60%",
            }}
          >
            <ScrollView contentContainerStyle={{ padding: spacing.screen, gap: 2 }}>
              {COUNTRY_CALLING_CODES.map((country) => (
                <Pressable
                  key={country.iso}
                  accessibilityRole="button"
                  accessibilityLabel={`${country.label}, ${country.dialCode}`}
                  onPress={() => {
                    setCountryCode(country.dialCode);
                    setCountryPickerOpen(false);
                  }}
                  style={{ paddingVertical: 12, flexDirection: "row", justifyContent: "space-between" }}
                >
                  <Text style={{ fontSize: 15, color: colors.ink }}>{country.label}</Text>
                  <Text style={{ fontSize: 15, color: colors.muted }}>{country.dialCode}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 8,
        borderRadius: radius.control - 2,
        alignItems: "center",
        backgroundColor: active ? colors.card : "transparent",
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "600", color: active ? colors.brand : colors.muted }}>
        {label}
      </Text>
    </Pressable>
  );
}
