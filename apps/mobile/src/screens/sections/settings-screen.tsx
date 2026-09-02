import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { colors, radius, spacing } from "@/ui/theme";
import { CalloutCard, GroupedList, GroupedListRow, MutedText, SecondaryButton, SectionDivider, SectionLabel } from "@/ui/components";
import { WebViewScreen } from "@/screens/webview-screen";
import { PLATFORM_URL } from "@/lib/platform-url";
import { supabase } from "@/lib/supabase";
import type { SectionId } from "@/lib/sections";

const APP_LOCK_KEY = "settings-app-lock-v1";
const NOTIF_PREFS_KEY = "settings-notification-prefs-v1";

interface NotifPrefs {
  refill: boolean;
  careTeam: boolean;
  education: boolean;
}

const DEFAULT_PREFS: NotifPrefs = { refill: true, careTeam: true, education: false };

interface SettingsScreenProps {
  patientName: string;
  initials: string;
  onNavigate: (section: SectionId) => void;
}

export function SettingsScreen({ patientName, initials, onNavigate }: SettingsScreenProps) {
  const firstName = patientName.split(/\s+/)[0] ?? patientName;
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
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.screen, gap: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View>
          <Text style={{ fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", color: colors.muted }}>
            Hello,
          </Text>
          <Text style={{ fontSize: 27, fontWeight: "800", color: colors.ink }}>{firstName}</Text>
        </View>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: "#E7EEE7",
            alignItems: "center",
            justifyContent: "center",
            shadowColor: colors.brand,
            shadowOpacity: 0.35,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 0 },
            elevation: 4,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.brandPressed }}>{initials}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <ProfileTile
          icon="person-outline"
          label="Profile data"
          onPress={() => setWebviewPath("/patient/profile")}
        />
        <ProfileTile
          icon="card-outline"
          label="My services"
          // System browser, never the in-app WebView — MOBILE_APP_SPEC.md §7:
          // embedding checkout risks Apple App Store Review 3.1.1 (digital
          // purchases must use IAP unless bought outside the app).
          onPress={() => void WebBrowser.openBrowserAsync(`${PLATFORM_URL}/patient/subscription`)}
        />
      </View>

      <SectionDivider />

      <View style={{ gap: 10 }}>
        <SectionLabel>Security &amp; notifications</SectionLabel>
        <MutedText>
          App lock, and what we notify you about — saved on this device now, full push delivery for these
          categories is still being built.
        </MutedText>
        <GroupedList>
          {biometricAvailable ? (
            <GroupedListRow
              title="App lock"
              subtitle="Require Face ID / fingerprint to open the app."
              trailing={<Toggle value={appLockEnabled} onChange={toggleAppLock} />}
            />
          ) : null}
          <GroupedListRow
            title="Refill & dose reminders"
            trailing={<Toggle value={prefs.refill} onChange={() => updatePref("refill", !prefs.refill)} small />}
          />
          <GroupedListRow
            title="Care team messages"
            trailing={<Toggle value={prefs.careTeam} onChange={() => updatePref("careTeam", !prefs.careTeam)} small />}
          />
          <GroupedListRow
            title="Health education tips"
            trailing={<Toggle value={prefs.education} onChange={() => updatePref("education", !prefs.education)} small />}
          />
        </GroupedList>
      </View>

      <SectionDivider />

      <View style={{ gap: 10 }}>
        <SectionLabel>Help &amp; contact</SectionLabel>
        <CalloutCard
          icon="chatbox-ellipses-outline"
          title="Message your care team"
          subtitle="Ask a question and hear back from the doctors reviewing your case."
          ctaLabel="Open chat"
          onPress={() => onNavigate("messages")}
        />
        <CalloutCard
          icon="help-buoy-outline"
          title="Care & support"
          subtitle="Useful links, common questions, and how to reach us."
          ctaLabel="Open"
          onPress={() => onNavigate("care")}
        />
      </View>

      <SectionDivider />

      <Pressable
        accessibilityRole="button"
        onPress={() => void supabase.auth.signOut()}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.ink} />
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>Sign out</Text>
      </Pressable>

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

/** Larger shortcut tile for the two account-level destinations that live
 * outside this screen (profile data in a webview, services purchasing in the
 * system browser) — "Profile data / Settings" in the reference design. */
function ProfileTile({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: colors.groupBg,
        borderRadius: radius.card,
        padding: spacing.card,
        gap: 22,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={colors.ink} />
      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>{label}</Text>
    </Pressable>
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
