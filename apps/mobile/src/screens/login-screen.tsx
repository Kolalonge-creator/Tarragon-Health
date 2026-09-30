import { useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import appIcon from "../../assets/icon.png";
import { normalisePhoneWithCountry } from "@tarragon/auth/phone";
import { COUNTRY_CALLING_CODES } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import { ta } from "@/lib/auth/auth-locale";
import { requestPhoneCode, signInWithPhonePassword } from "@/lib/auth/auth-flow";
import { useAuthLocale } from "@/lib/auth/use-auth-locale";
import { LanguageChooser } from "@/screens/language-chooser";
import { VerifyCodeStep } from "@/screens/verify-code-step";
import { colors, inkAlpha, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";
import { SignUpScreen } from "@/screens/signup-screen";
import { ForgotPasswordScreen } from "@/screens/forgot-password-screen";

/** Supabase auth error strings are developer-facing ("Invalid login
 * credentials") — map the common ones to warm plain language, with a safe
 * generic fallback so no raw API string ever reaches a patient. */
function friendlySignInError(rawMessage: string): string {
  const message = rawMessage.toLowerCase();
  if (message.includes("invalid login credentials")) {
    return "That email and password don't match. Check them and try again, or reset your password below.";
  }
  if (message.includes("email not confirmed")) {
    return "Your email hasn't been confirmed yet. Open the confirmation email we sent you, then sign in again.";
  }
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return "Too many attempts for now. Wait a few minutes and try again.";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return "We couldn't sign you in just now. Please try again.";
}

/**
 * App-level auth gate in front of the whole signed-in app — every section
 * behind the tab bar and drawer (docs/MOBILE_APP_SPEC.md §1). Sign-in and
 * account creation are both native: "Create your account" opens SignUpScreen
 * (signup-screen.tsx), a plain app-native form mirroring the web signup flow
 * field-for-field. Signup involves no payment or plan selection (the
 * 2026-09-02 "free app, pay-per-service" pivot — see CLAUDE.md), so there
 * was never a payment-embedding concern here to begin with; that guardrail
 * lives in the separate settings-screen subscription/payment hand-off to the
 * system browser, unrelated to this screen.
 */
type SignInMethod = "phone" | "email";
type PhoneMode = "password" | "code";
/** verify-confirm: number was never confirmed. verify-code: code sign-in entry. */
type PhoneStep = "form" | "verify-confirm" | "verify-code";

export function LoginScreen() {
  const [locale, chooseLocale] = useAuthLocale();
  const [method, setMethod] = useState<SignInMethod>("phone");
  const [phoneMode, setPhoneMode] = useState<PhoneMode>("password");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("form");
  // Nigeria is the default; any other country can be typed with its +code in the number field.
  const countryCode: string = COUNTRY_CALLING_CODES[0].dialCode;
  const [localPhone, setLocalPhone] = useState("");
  const [verifyPhone, setVerifyPhone] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupOpen, setSignupOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSignIn() {
    // Guard before the network round-trip — a blank submit shouldn't cost a
    // request (or a confusing "invalid credentials" message).
    if (!email.trim() || !password) {
      setError("Enter your email and password to sign in.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (signInError) setError(friendlySignInError(signInError.message));
  }

  async function handlePhoneSignIn() {
    const phone = normalisePhoneWithCountry(countryCode, localPhone);
    if (!phone.ok) {
      setError(ta("auth.error.invalid_phone", locale));
      return;
    }
    setError(null);
    if (phoneMode === "code") {
      setLoading(true);
      const outcome = await requestPhoneCode(supabase.auth, phone.e164);
      setLoading(false);
      if (outcome.kind === "error") {
        setError(ta(outcome.key, locale));
        return;
      }
      setVerifyPhone(phone.e164);
      setPhoneStep("verify-code");
      return;
    }
    if (!password) {
      setError(ta("auth.error.sign_in_failed", locale));
      return;
    }
    setLoading(true);
    const outcome = await signInWithPhonePassword(supabase.auth, { phone: phone.e164, password });
    setLoading(false);
    if (outcome.kind === "needs_verification") {
      setVerifyPhone(phone.e164);
      setPhoneStep("verify-confirm");
      return;
    }
    if (outcome.kind === "error") setError(ta(outcome.key, locale));
    // signed_in: App.tsx's auth listener takes over.
  }

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    padding: 14,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
  } as const;

  return (
    // Keyboard handling: on small phones the keyboard covered the password
    // field and Sign in button — the avoiding view lifts them, and the
    // ScrollView keeps everything reachable when even that isn't enough.
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: spacing.screen,
          gap: 12,
        }}
      >
        <View style={{ alignItems: "center", marginBottom: 20 }}>
          <Image
            source={appIcon}
            style={{ width: 72, height: 72, borderRadius: 18, marginBottom: 12 }}
            accessibilityIgnoresInvertColors
          />
          <Text style={{ fontSize: 26, fontWeight: "700", color: colors.brand }}>
            TarragonHealth
          </Text>
          <MutedText>Care that stays with you.</MutedText>
        </View>
        <LanguageChooser locale={locale} onChange={chooseLocale} />
        {method === "phone" && phoneStep !== "form" && verifyPhone ? (
          <VerifyCodeStep
            phone={verifyPhone}
            locale={locale}
            kind={phoneStep === "verify-confirm" ? "confirm" : "signin"}
            notice={phoneStep === "verify-confirm" ? ta("auth.signin.unverified", locale) : undefined}
            onBack={() => {
              setPhoneStep("form");
              setVerifyPhone(null);
            }}
          />
        ) : (
        <>
        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>
          {ta("auth.signin.title", locale)}
        </Text>
        <View
          style={{
            flexDirection: "row",
            backgroundColor: inkAlpha(0.05),
            borderRadius: radius.control,
            padding: 4,
            gap: 4,
          }}
        >
          {(["phone", "email"] as const).map((m) => (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityLabel={m === "phone" ? "Use phone" : "Use email"}
              accessibilityState={{ selected: method === m }}
              onPress={() => {
                setMethod(m);
                setError(null);
              }}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 8,
                borderRadius: radius.control - 2,
                backgroundColor: method === m ? colors.card : "transparent",
              }}
            >
              <Text style={{ fontWeight: "600", color: method === m ? colors.ink : colors.muted }}>
                {ta(m === "phone" ? "auth.method.phone" : "auth.method.email", locale)}
              </Text>
            </Pressable>
          ))}
        </View>
        {method === "phone" ? (
          <>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={[inputStyle, { width: 92, justifyContent: "center" }]}>
                <Text style={{ fontSize: 16, color: colors.ink }}>{countryCode}</Text>
              </View>
              <TextInput
                accessibilityLabel={ta("auth.field.phone", locale)}
                placeholder={ta("auth.field.phone", locale)}
                placeholderTextColor={colors.faint}
                keyboardType="phone-pad"
                autoComplete="tel"
                value={localPhone}
                onChangeText={setLocalPhone}
                style={[inputStyle, { flex: 1 }]}
              />
            </View>
            <View style={{ flexDirection: "row", gap: 16 }}>
              {(["password", "code"] as const).map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityState={{ selected: phoneMode === m }}
                  onPress={() => {
                    setPhoneMode(m);
                    setError(null);
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      color: phoneMode === m ? colors.brand : colors.muted,
                    }}
                  >
                    {ta(m === "password" ? "auth.signin.method_password" : "auth.signin.method_code", locale)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
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
        )}
        {method === "phone" && phoneMode === "code" ? null : (
        <View style={{ justifyContent: "center" }}>
          <TextInput
            accessibilityLabel="Password"
            placeholder="Password"
            placeholderTextColor={colors.faint}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            style={[inputStyle, { paddingRight: 44 }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            onPress={() => setShowPassword((v) => !v)}
            style={{ position: "absolute", right: 12, height: "100%", justifyContent: "center" }}
          >
            <Ionicons name={showPassword ? "eye-off" : "eye"} size={20} color={colors.faint} />
          </Pressable>
        </View>
        )}
        {error ? <ErrorText>{error}</ErrorText> : null}
        {method === "phone" ? (
          <PrimaryButton
            title={
              phoneMode === "code"
                ? ta("auth.signin.send_code", locale)
                : loading
                  ? ta("auth.signin.submitting", locale)
                  : ta("auth.signin.submit", locale)
            }
            onPress={handlePhoneSignIn}
            loading={loading}
          />
        ) : (
          <PrimaryButton title="Sign in" onPress={handleSignIn} loading={loading} />
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => setForgotOpen(true)}
          style={{ alignItems: "center", paddingVertical: 4 }}
        >
          <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "600" }}>{ta("auth.signin.forgot", locale)}</Text>
        </Pressable>
        <SecondaryButton title={ta("auth.signup.title", locale)} onPress={() => setSignupOpen(true)} />
        </>
        )}
      </ScrollView>

      <Modal visible={signupOpen} animationType="slide" onRequestClose={() => setSignupOpen(false)}>
        <SignUpScreen onClose={() => setSignupOpen(false)} />
      </Modal>

      <Modal visible={forgotOpen} animationType="slide" onRequestClose={() => setForgotOpen(false)}>
        <ForgotPasswordScreen onClose={() => setForgotOpen(false)} />
      </Modal>
    </KeyboardAvoidingView>
  );
}
