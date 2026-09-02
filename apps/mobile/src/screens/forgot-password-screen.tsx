import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COUNTRY_CALLING_CODES, E164_GENERIC } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import { PLATFORM_URL } from "@/lib/platform-url";
import { colors, radius, spacing } from "@/ui/theme";
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
        placeholderTextColor={colors.faint}
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
  const [tab, setTab] = useState<Tab>("phone");
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

  const fullPhone = `${countryCode}${localPhone.trim()}`;

  async function sendPhoneCode() {
    setError(null);
    if (!E164_GENERIC.test(fullPhone)) {
      setError("Enter a valid phone number for the selected country");
      return;
    }
    setLoading(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({ phone: fullPhone });
    setLoading(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setPhoneStep("verify");
  }

  async function verifyCode() {
    setError(null);
    if (otp.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    setLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: fullPhone,
      token: otp,
      type: "sms",
    });
    setLoading(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    setPhoneStep("new-password");
  }

  async function submitNewPassword() {
    setError(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
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
      setError("Could not send reset email. Please try again.");
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
            Reset your password
          </Text>
          <MutedText>We can text you a code, or email you a reset link.</MutedText>
        </View>

        <View
          style={{
            flexDirection: "row",
            backgroundColor: "rgba(23,23,23,0.05)",
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
                    onPress={() => setCountryPickerOpen(true)}
                    style={[inputStyle, { width: 92, justifyContent: "center" }]}
                  >
                    <Text style={{ fontSize: 16, color: colors.ink }}>{countryCode}</Text>
                  </Pressable>
                  <TextInput
                    accessibilityLabel="Phone number"
                    placeholder="XXXXXXXXXX"
                    placeholderTextColor={colors.faint}
                    keyboardType="phone-pad"
                    value={localPhone}
                    onChangeText={setLocalPhone}
                    style={[inputStyle, { flex: 1 }]}
                  />
                </View>
                {error ? <ErrorText>{error}</ErrorText> : null}
                <PrimaryButton title="Send code" onPress={sendPhoneCode} loading={loading} />
              </>
            ) : phoneStep === "verify" ? (
              <>
                <MutedText>Enter the 6-digit code sent to {fullPhone}.</MutedText>
                <TextInput
                  accessibilityLabel="Verification code"
                  placeholder="123456"
                  placeholderTextColor={colors.faint}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otp}
                  onChangeText={setOtp}
                  style={inputStyle}
                />
                {error ? <ErrorText>{error}</ErrorText> : null}
                <PrimaryButton title="Verify code" onPress={verifyCode} loading={loading} />
                <SecondaryButton
                  title="Use a different number"
                  onPress={() => {
                    setPhoneStep("request");
                    setOtp("");
                    setError(null);
                  }}
                />
              </>
            ) : (
              <>
                <MutedText>Choose a new password for your account.</MutedText>
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
          <MutedText>
            If an account exists for that email, we&apos;ve sent a link to reset your password.
            Open it on your phone or computer to finish — check your inbox and spam folder.
          </MutedText>
        ) : (
          <View style={{ gap: 10 }}>
            <TextInput
              accessibilityLabel="Email"
              placeholder="Email"
              placeholderTextColor={colors.faint}
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
        <Pressable
          onPress={() => setCountryPickerOpen(false)}
          style={{ flex: 1, backgroundColor: "rgba(23,23,23,0.4)", justifyContent: "flex-end" }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: radius.card,
              borderTopRightRadius: radius.card,
              padding: spacing.screen,
              gap: 2,
            }}
          >
            {COUNTRY_CALLING_CODES.map((country) => (
              <Pressable
                key={country.iso}
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
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
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
