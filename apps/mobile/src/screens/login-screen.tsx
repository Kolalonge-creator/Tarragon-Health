import { useState } from "react";
import { Image, Modal, Pressable, Text, TextInput, View } from "react-native";
import appIcon from "../../assets/icon.png";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";
import { ForgotPasswordScreen } from "@/screens/forgot-password-screen";

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

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) setError(signInError.message);
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
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: spacing.screen,
        gap: 12,
        backgroundColor: colors.background,
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
      <TextInput
        accessibilityLabel="Password"
        placeholder="Password"
        placeholderTextColor={colors.faint}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={inputStyle}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <PrimaryButton title="Sign in" onPress={handleSignIn} loading={loading} />
      <Pressable onPress={() => setForgotOpen(true)} style={{ alignItems: "center", paddingVertical: 4 }}>
        <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "600" }}>Forgot password?</Text>
      </Pressable>
      <SecondaryButton title="Create your account" onPress={() => setSignupOpen(true)} />

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
    </View>
  );
}
