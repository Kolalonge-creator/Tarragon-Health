import { useEffect, useState } from "react";
import { ActivityIndicator, Image, SafeAreaView, StatusBar } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import logoMarkWhite from "./assets/logo-mark-white.png";
import { registerBackgroundHealthSync } from "@/lib/background-sync";
import { registerPushToken } from "@/lib/push-registration";
import { flushPendingVitals } from "@/lib/offline-vitals-queue";
import { syncThresholdsIfOnline } from "@/lib/threshold-sync";
import { loadPatientIdentity, type PatientIdentity } from "@/lib/identity";
import { LoginScreen } from "@/screens/login-screen";
import { HomeShell } from "@/screens/home-shell";
import { colors } from "@/ui/theme";

/**
 * App-level shape: a native auth gate (Splash → Login) in front of the
 * authenticated shell (home-shell.tsx), which owns all navigation — the
 * bottom tab bar (Home/Vitals/Meds/Messages/More) plus the drawer behind
 * More. Devices (native BLE pairing/sync + Apple Health) is one of the
 * shell's sections, reachable from the drawer; the legacy two-tab
 * Home/Devices bar this file used to render on top of the shell's own tab
 * bar (the "two stacked bars" bug) is gone.
 */
export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [identity, setIdentity] = useState<PatientIdentity | null | undefined>(undefined);

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
      // Same "best-effort, never blocking" contract as the line above — a
      // patient reopening the app with signal is the fastest path to
      // draining anything queued while they were offline, well ahead of the
      // background task's 15-minute floor.
      flushPendingVitals().catch(() => {});
      syncThresholdsIfOnline().catch(() => {});
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.card }}>
      <StatusBar barStyle="dark-content" />
      <HomeShell
        userId={session.user.id}
        organisationId={identity.organisationId}
        patientName={identity.fullName}
        patientNumber={identity.patientNumber}
        initials={identity.initials}
      />
    </SafeAreaView>
  );
}
