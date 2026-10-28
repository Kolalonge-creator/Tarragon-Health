import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StatusBar, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { authenticate } from "@/lib/app-lock";
import { lockAppPinForGate, usePrivateLock } from "@/lib/private-lock";
import { UnlockCard } from "@/ui/private-section";
import { signOutOfThisPhone } from "@/lib/sign-out";
import { colors, radius, spacing } from "@/ui/theme";
import { useTheme } from "@/ui/design";
import logoMarkWhite from "../../assets/logo-mark-white.png";

interface AppLockScreenProps {
  /** The signed-in account: the app PIN, when one is set, belongs to it and to this phone. */
  accountId: string;
  onUnlocked: () => void;
}

/**
 * Full-screen biometric gate rendered INSTEAD of the authenticated shell,
 * never over it — nothing of the patient's record may mount (or survive in
 * the app switcher snapshot) until the prompt succeeds. Styled to match the
 * brand-green splash so lock and cold start read as one surface.
 */
export function AppLockScreen({ accountId, onUnlocked }: AppLockScreenProps) {
  // The optional app PIN. When one is set it is the ONLY way in: the device prompt falls back to the phone's passcode, which would let
  // anyone who knows that passcode through. With no PIN set (the default), nothing here changes.
  // Re-lock the PIN first, in the first render, before the hook reads its state (see lockAppPinForGate: without this the PIN is only
  // asked for on a cold start).
  useState(() => {
    lockAppPinForGate(accountId);
    return true;
  });
  const appPin = usePrivateLock(accountId, "app");
  const pinRequired = appPin.status === "locked";
  const pinChecking = appPin.status === "loading";
  const [authenticating, setAuthenticating] = useState(false);
  const [failedOnce, setFailedOnce] = useState(false);
  const inFlight = useRef(false);
  // Light keeps the brand-green splash; Dark uses the dark canvas with the same layout.
  const { scheme, colors: palette } = useTheme();
  const dark = scheme === "dark";
  const textColor = dark ? palette.text : "#FFFFFF";
  const mutedColor = dark ? palette.textMuted : "rgba(255,255,255,0.85)";

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
    // One automatic prompt on mount; the Unlock button covers every retry. Not while the PIN state is still being read, and never
    // when a PIN is the way in.
    if (inFlight.current || pinChecking || pinRequired) return;
    void tryUnlock();
  }, [tryUnlock, pinChecking, pinRequired]);

  // The PIN was entered correctly: the controller moves to "unlocked" and the app opens.
  const wasLocked = useRef(false);
  useEffect(() => {
    if (pinRequired) wasLocked.current = true;
    else if (wasLocked.current && appPin.status === "unlocked") onUnlocked();
  }, [pinRequired, appPin.status, onUnlocked]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: dark ? palette.canvas : colors.brand }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.screen }}>
        <Image
          source={logoMarkWhite}
          style={{ width: 96, height: 133, marginBottom: 32 }}
          resizeMode="contain"
        />
        <Text style={{ fontSize: 22, fontWeight: "800", color: textColor, marginBottom: 8 }}>
          Welcome back
        </Text>
        {pinRequired ? (
          <View style={{ width: "100%", maxWidth: 360, marginBottom: 12 }}>
            <UnlockCard title="Enter your PIN" lock={appPin} />
          </View>
        ) : (
          <>
            <Text
              style={{
                fontSize: 15,
                lineHeight: 22,
                color: mutedColor,
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
                backgroundColor: dark ? (pressed ? palette.brandPressed : palette.brand) : pressed ? "rgba(255,255,255,0.85)" : "#FFFFFF",
                borderRadius: radius.control,
                paddingVertical: 14,
                paddingHorizontal: 48,
                alignItems: "center",
                justifyContent: "center",
                opacity: authenticating ? 0.6 : 1,
              })}
            >
              <Text style={{ color: dark ? palette.textOnBrand : colors.brand, fontSize: 16, fontWeight: "700" }}>Unlock</Text>
            </Pressable>
          </>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => void signOutOfThisPhone()}
          style={({ pressed }) => ({ marginTop: 20, padding: 8, opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ color: mutedColor, fontSize: 14, fontWeight: "600" }}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
