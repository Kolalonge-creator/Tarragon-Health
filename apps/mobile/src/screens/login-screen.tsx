import { useState } from "react";
import { Image, Text, TextInput, View } from "react-native";
import appIcon from "../../assets/icon.png";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing } from "@/ui/theme";
import { ErrorText, MutedText, PrimaryButton } from "@/ui/components";

/**
 * Sign-in only — account creation stays on web/app onboarding
 * (apps/web/src/app/onboarding) per CLAUDE.md: signup is app/web only, and
 * that flow already exists there. This screen exists purely so an already
 *-registered patient can authenticate this device for BLE pairing/sync.
 */
export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        Sign in to sync your devices
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
      <MutedText>
        New to TarragonHealth? Create your account on the Home tab first.
      </MutedText>
    </View>
  );
}
