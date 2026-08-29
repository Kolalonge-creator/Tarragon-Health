import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, SafeAreaView, StatusBar, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import type { Tables } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import logoMarkWhite from "./assets/logo-mark-white.png";
import { registerBackgroundHealthSync } from "@/lib/background-sync";
import { registerPushToken } from "@/lib/push-registration";
import { loadPatientIdentity, type PatientIdentity } from "@/lib/identity";
import { LoginScreen } from "@/screens/login-screen";
import { HomeShell } from "@/screens/home-shell";
import { DevicesScreen } from "@/screens/devices-screen";
import { SyncScreen } from "@/screens/sync-screen";
import { colors } from "@/ui/theme";

type PatientDevice = Tables<"patient_devices">;
type Tab = "home" | "devices";

/**
 * App-level shape: a native auth gate (Splash → Login) in front of both
 * tabs, then Home (the native shell + per-section WebViews, see
 * home-shell.tsx) and Devices (native BLE pairing/sync + Apple Health) —
 * the two tabs from the Claude Design prototype's iOS frame.
 */
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [identity, setIdentity] = useState<PatientIdentity | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("home");
  const [openDevice, setOpenDevice] = useState<PatientDevice | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user.id) {
      setIdentity(session === null ? null : undefined);
      return;
    }
    setIdentity(undefined);
    loadPatientIdentity(session.user.id).then(setIdentity);
  }, [session]);

  useEffect(() => {
    if (session && identity) {
      // Fire-and-forget, but never unhandled: background health sync is a
      // best-effort enhancement, and a rejection here used to redbox the app
      // for every patient signing in under Expo Go (no Nitro native module).
      // Nothing the patient does depends on this resolving.
      registerBackgroundHealthSync().catch(() => {});
      // Same fire-and-forget contract — a patient who denies the permission
      // prompt, or a dev build with no EAS project id, still gets a fully
      // working app; this only ever adds a remote-push capability on top.
      registerPushToken(session.user.id, identity.organisationId).catch(() => {});
    }
  }, [session, identity]);

  if (session === undefined || (session && identity === undefined)) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand }}>
        <StatusBar barStyle="light-content" />
        <Image
          source={logoMarkWhite}
          style={{ width: 96, height: 133, marginBottom: 32 }}
          resizeMode="contain"
        />
        <ActivityIndicator color="#FFFFFF" />
      </SafeAreaView>
    );
  }

  if (!session || !identity) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar barStyle="dark-content" />
        <LoginScreen />
      </SafeAreaView>
    );
  }

  function renderDevicesTab() {
    if (openDevice) {
      return <SyncScreen device={openDevice} onBack={() => setOpenDevice(null)} />;
    }
    return (
      <DevicesScreen patientId={session!.user.id} organisationId={identity!.organisationId} onOpenDevice={setOpenDevice} />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.card }}>
      <StatusBar barStyle="dark-content" />
      <View style={{ flex: 1 }}>
        {/* Both tabs stay mounted so switching back preserves scroll/section
            state, same rationale as the old all-WebView Home tab had. */}
        <View style={{ flex: 1, display: tab === "home" ? "flex" : "none" }}>
          <HomeShell
            userId={session.user.id}
            organisationId={identity.organisationId}
            patientName={identity.fullName}
            patientNumber={identity.patientNumber}
            initials={identity.initials}
          />
        </View>
        <View style={{ flex: 1, display: tab === "devices" ? "flex" : "none" }}>{renderDevicesTab()}</View>
      </View>
      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <TabButton label="Home" icon="home" active={tab === "home"} onPress={() => setTab("home")} />
        <TabButton label="Devices" icon="bluetooth" active={tab === "devices"} onPress={() => setTab("devices")} />
      </View>
    </SafeAreaView>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: "home" | "bluetooth";
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{ flex: 1, alignItems: "center", paddingVertical: 8, gap: 2 }}
    >
      <Ionicons
        name={active ? icon : (`${icon}-outline` as const)}
        size={22}
        color={active ? colors.brand : colors.muted}
      />
      <Text
        style={{
          fontSize: 11,
          fontWeight: active ? "700" : "500",
          color: active ? colors.brand : colors.muted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
