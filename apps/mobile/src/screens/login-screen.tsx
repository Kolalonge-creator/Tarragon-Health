import { useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import appIcon from "../../assets/icon.png";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";
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
 * App-level auth gate in front of both tabs (promoted from being reachable
 * only from the Devices tab — docs/MOBILE_APP_SPEC.md §1). Sign-in is
 * native; account creation stays app/web-only per CLAUDE.md but doesn't need
 * a native reimplementation of consent/KYC/plan-selection/payment (payment
 * embedding is explicitly banned — see §7) — "Create your account" opens the
 * real web signup flow inline in a WebView instead.
 */
export function LoginScreen() {
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
        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>
          Sign in to your account
        </Text>
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
        {error ? <ErrorText>{error}</ErrorText> : null}
        <PrimaryButton title="Sign in" onPress={handleSignIn} loading={loading} />
        <Pressable
          accessibilityRole="button"
          onPress={() => setForgotOpen(true)}
          style={{ alignItems: "center", paddingVertical: 4 }}
        >
          <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "600" }}>Forgot password?</Text>
        </Pressable>
        <SecondaryButton title="Create your account" onPress={() => setSignupOpen(true)} />
      </ScrollView>

      <Modal visible={signupOpen} animationType="slide" onRequestClose={() => setSignupOpen(false)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setSignupOpen(false)} />
          </View>
          <WebViewScreen path="/signup" />
        </View>
      </Modal>

      <Modal visible={forgotOpen} animationType="slide" onRequestClose={() => setForgotOpen(false)}>
        <ForgotPasswordScreen onClose={() => setForgotOpen(false)} />
      </Modal>
    </KeyboardAvoidingView>
  );
}
