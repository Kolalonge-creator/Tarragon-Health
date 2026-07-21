import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StatusBar,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import type { Tables } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import { LoginScreen } from "@/screens/login-screen";
import { DevicesScreen } from "@/screens/devices-screen";
import { SyncScreen } from "@/screens/sync-screen";
import { PlatformScreen } from "@/screens/platform-screen";

type PatientDevice = Tables<"patient_devices">;

type Tab = "platform" | "devices";

/**
 * Deliberately simple state-machine navigation (no react-navigation/
 * expo-router): two tabs — the full platform rendered from the live web
 * deployment (so it updates with every web deploy, no store release), and
 * the native Bluetooth device pairing/sync layer, which is the one thing
 * the web can't do.
 */
export default function App() {
  const [tab, setTab] = useState<Tab>("platform");
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [organisationId, setOrganisationId] = useState<string | null>(null);
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
      setOrganisationId(null);
      return;
    }
    supabase
      .from("profiles")
      .select("organisation_id")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setOrganisationId(data?.organisation_id ?? null));
  }, [session?.user.id]);

  function renderDevicesTab() {
    if (session === undefined) {
      return (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      );
    }
    if (!session) return <LoginScreen />;
    if (!organisationId) {
      return (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      );
    }
    if (openDevice) {
      return <SyncScreen device={openDevice} onBack={() => setOpenDevice(null)} />;
    }
    return (
      <DevicesScreen
        patientId={session.user.id}
        organisationId={organisationId}
        onOpenDevice={setOpenDevice}
      />
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar barStyle="dark-content" />
      <View style={{ flex: 1 }}>
        {/* The WebView stays mounted while on the devices tab so platform
            state (scroll position, form input) survives tab switches. */}
        <View style={{ flex: 1, display: tab === "platform" ? "flex" : "none" }}>
          <PlatformScreen />
        </View>
        {tab === "devices" ? renderDevicesTab() : null}
      </View>
      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 1,
          borderTopColor: "#E5E7EB",
          backgroundColor: "#FFFFFF",
        }}
      >
        <TabButton
          label="Home"
          icon="home"
          active={tab === "platform"}
          onPress={() => setTab("platform")}
        />
        <TabButton
          label="Devices"
          icon="bluetooth"
          active={tab === "devices"}
          onPress={() => setTab("devices")}
        />
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
        color={active ? "#0E7C52" : "#6B7280"}
      />
      <Text
        style={{
          fontSize: 11,
          fontWeight: active ? "700" : "500",
          color: active ? "#0E7C52" : "#6B7280",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
