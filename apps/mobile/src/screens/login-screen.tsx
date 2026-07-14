import { useState } from "react";
import { ActivityIndicator, Button, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";

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

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "600", marginBottom: 16 }}>Sign in to TarragonHealth</Text>
      <TextInput
        accessibilityLabel="Email"
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12 }}
      />
      <TextInput
        accessibilityLabel="Password"
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12 }}
      />
      {error ? <Text style={{ color: "#B3261E" }}>{error}</Text> : null}
      {loading ? <ActivityIndicator /> : <Button title="Sign in" onPress={handleSignIn} />}
    </View>
  );
}
