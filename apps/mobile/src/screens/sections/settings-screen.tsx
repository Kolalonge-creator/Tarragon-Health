import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { colors, spacing } from "@/ui/theme";
import { Card, MutedText, SecondaryButton } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";
import { supabase } from "@/lib/supabase";

const APP_LOCK_KEY = "settings-app-lock-v1";
const NOTIF_PREFS_KEY = "settings-notification-prefs-v1";

interface NotifPrefs {
  refill: boolean;
  careTeam: boolean;
  education: boolean;
}

const DEFAULT_PREFS: NotifPrefs = { refill: true, careTeam: true, education: false };

export function SettingsScreen() {
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [webviewPath, setWebviewPath] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(
      ([hasHardware, isEnrolled]) => setBiometricAvailable(hasHardware && isEnrolled)
    );
    SecureStore.getItemAsync(APP_LOCK_KEY).then((v) => setAppLockEnabled(v === "true"));
    SecureStore.getItemAsync(NOTIF_PREFS_KEY).then((v) => {
      if (v) setPrefs(JSON.parse(v) as NotifPrefs);
    });
  }, []);

  async function toggleAppLock() {
    if (!appLockEnabled) {
      // Confirm with a real biometric prompt before turning the lock on —
      // otherwise a patient could enable a lock they can't actually pass.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm to turn on App Lock",
      });
      if (!result.success) return;
    }
    const next = !appLockEnabled;
    setAppLockEnabled(next);
    await SecureStore.setItemAsync(APP_LOCK_KEY, String(next));
  }

  async function updatePref(key: keyof NotifPrefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await SecureStore.setItemAsync(NOTIF_PREFS_KEY, JSON.stringify(next));
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 14 }}>
      <View>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>Settings</Text>
        <MutedText>App security, alerts, and your profile.</MutedText>
      </View>

      {biometricAvailable ? (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>App lock</Text>
              <MutedText>Require Face ID / fingerprint to open the app.</MutedText>
            </View>
            <Toggle value={appLockEnabled} onChange={toggleAppLock} />
          </View>
        </Card>
      ) : null}

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, marginBottom: 6 }}>
          Notification preferences
        </Text>
        <MutedText>
          Saved on this device now — full push delivery for these categories is still being built.
        </MutedText>
        <PrefRow label="Refill & dose reminders" value={prefs.refill} onChange={(v) => updatePref("refill", v)} />
        <PrefRow label="Care team messages" value={prefs.careTeam} onChange={(v) => updatePref("careTeam", v)} />
        <PrefRow label="Health education tips" value={prefs.education} onChange={(v) => updatePref("education", v)} />
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>
          Personal details, privacy &amp; subscription
        </Text>
        <MutedText>Contact info, identity verification, data export/delete, and your subscription open in your browser.</MutedText>
        <SecondaryButton title="Personal details & privacy" onPress={() => setWebviewPath("/patient/profile")} />
        <SecondaryButton title="Manage subscription" onPress={() => setWebviewPath("/patient/subscription")} />
      </Card>

      <SecondaryButton title="Sign out" onPress={() => void supabase.auth.signOut()} />

      <Modal visible={webviewPath !== null} animationType="slide" onRequestClose={() => setWebviewPath(null)}>
        <View style={{ flex: 1 }}>
          <View style={{ padding: spacing.screen, paddingTop: 56 }}>
            <SecondaryButton title="Close" onPress={() => setWebviewPath(null)} />
          </View>
          {webviewPath ? <WebViewScreen path={webviewPath} /> : null}
        </View>
      </Modal>
    </ScrollView>
  );
}

function PrefRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 8,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 13, color: colors.ink, flex: 1 }}>{label}</Text>
      <Toggle value={value} onChange={() => onChange(!value)} small />
    </View>
  );
}

function Toggle({ value, onChange, small }: { value: boolean; onChange: () => void; small?: boolean }) {
  const width = small ? 38 : 42;
  const height = small ? 22 : 24;
  const knob = small ? 18 : 20;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onChange}
      style={{
        width,
        height,
        borderRadius: 999,
        padding: 2,
        backgroundColor: value ? colors.brand : "rgba(23,23,23,0.15)",
      }}
    >
      <View
        style={{
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          backgroundColor: "#fff",
          marginLeft: value ? width - knob - 4 : 0,
        }}
      />
    </Pressable>
  );
}
