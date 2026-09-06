import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, SafeAreaView, StatusBar, Text, View } from "react-native";
import { authenticate } from "@/lib/app-lock";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing } from "@/ui/theme";
import logoMarkWhite from "../../assets/logo-mark-white.png";

interface AppLockScreenProps {
  onUnlocked: () => void;
}

/**
 * Full-screen biometric gate rendered INSTEAD of the authenticated shell,
 * never over it — nothing of the patient's record may mount (or survive in
 * the app switcher snapshot) until the prompt succeeds. Styled to match the
 * brand-green splash so lock and cold start read as one surface.
 */
export function AppLockScreen({ onUnlocked }: AppLockScreenProps) {
  const [authenticating, setAuthenticating] = useState(false);
  const [failedOnce, setFailedOnce] = useState(false);
  const inFlight = useRef(false);

  const tryUnlock = useCallback(async () => {
    // Ref guard rather than state: authenticateAsync must never run twice
    // concurrently (Android's BiometricPrompt errors the second caller).
    if (inFlight.current) return;
    inFlight.current = true;
    setAuthenticating(true);
    const result = await authenticate();
    inFlight.current = false;
    setAuthenticating(false);
    if (result === "failed") {
      setFailedOnce(true);
      return;
    }
    // "unavailable" unlocks too: the device no longer has any biometric or
    // passcode to check against, and a gate nobody can pass is a bricked
    // app, not security. Sign out below stays the stricter option.
    onUnlocked();
  }, [onUnlocked]);

  useEffect(() => {
    // One automatic prompt on mount; the Unlock button covers every retry.
    if (inFlight.current) return;
    void tryUnlock();
  }, [tryUnlock]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.brand }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.screen }}>
        <Image
          source={logoMarkWhite}
          style={{ width: 96, height: 133, marginBottom: 32 }}
          resizeMode="contain"
        />
        <Text style={{ fontSize: 22, fontWeight: "800", color: "#FFFFFF", marginBottom: 8 }}>
          Welcome back
        </Text>
        <Text
          style={{
            fontSize: 15,
            lineHeight: 22,
            color: "rgba(255,255,255,0.85)",
            textAlign: "center",
            marginBottom: 28,
            maxWidth: 300,
          }}
        >
          {failedOnce
            ? "That did not go through. You can try again, or sign out and log back in with your password."
            : "Unlock with Face ID or your fingerprint to pick up where you left off."}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: authenticating }}
          disabled={authenticating}
          onPress={() => void tryUnlock()}
          style={({ pressed }) => ({
            backgroundColor: pressed ? "rgba(255,255,255,0.85)" : "#FFFFFF",
            borderRadius: radius.control,
            paddingVertical: 14,
            paddingHorizontal: 48,
            alignItems: "center",
            justifyContent: "center",
            opacity: authenticating ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.brand, fontSize: 16, fontWeight: "700" }}>Unlock</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void supabase.auth.signOut()}
          style={({ pressed }) => ({ marginTop: 20, padding: 8, opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "600" }}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
