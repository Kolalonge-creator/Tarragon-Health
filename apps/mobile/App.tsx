import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, InteractionManager, Image, StatusBar, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import logoMarkWhite from "./assets/logo-mark-white.png";
import { readAppLockEnabled } from "@/lib/app-lock";
import { registerBackgroundHealthSync } from "@/lib/background-sync";
import { registerPushToken } from "@/lib/push-registration";
import { flushPendingVitals } from "@/lib/offline-vitals-queue";
import { syncThresholdsIfOnline } from "@/lib/threshold-sync";
import { loadPatientIdentity, type PatientIdentity } from "@/lib/identity";
import { LoginScreen } from "@/screens/login-screen";
import { AppLockScreen } from "@/screens/app-lock-screen";
import { HomeShell } from "@/screens/home-shell";
import { colors, spacing, typeScale } from "@/ui/theme";
import { PrimaryButton, MutedText } from "@/ui/components";

/** How long the cold-start gate (session → identity → lock) may sit on the
 * branded splash before offering a manual retry — see STUCK_LOADING_TIMEOUT_MS
 * usage below for why this exists at all. */
const STUCK_LOADING_TIMEOUT_MS = 8000;

/** "unknown" holds the splash: the shell must never flash unlocked before the
 * stored App Lock preference has been read (cold start locks too). */
type LockState = "unknown" | "locked" | "unlocked";

/**
 * App-level shape: a native auth gate (Splash → Login) in front of the
 * authenticated shell (home-shell.tsx), which owns all navigation — the
 * bottom tab bar (Home/Vitals/Meds/Messages/More) plus the drawer behind
 * More. Devices (native BLE pairing/sync + Apple Health) is one of the
 * shell's sections, reachable from the drawer; the legacy two-tab
 * Home/Devices bar this file used to render on top of the shell's own tab
 * bar (the "two stacked bars" bug) is gone.
 *
 * Wrapped in SafeAreaProvider (below) so every SafeAreaView in this file and
 * TopBar's own useSafeAreaInsets() read real inset values on Android instead
 * of RN's built-in SafeAreaView, which is an iOS-only shim that no-ops (falls
 * back to a plain View) everywhere else — see react-native-safe-area-context.
 */
function AppContent() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [identity, setIdentity] = useState<PatientIdentity | null | undefined>(undefined);
  const [lockState, setLockState] = useState<LockState>("unknown");
  // Only a real trip through 'background' re-locks; the 'inactive' flicker
  // from the iOS app switcher or a permission sheet must not.
  const wentToBackground = useRef(false);
  // Bumped by the stuck-loading retry screen below to re-run both the
  // session fetch and the identity fetch without a full app relaunch.
  const [retryToken, setRetryToken] = useState(0);
  // See STUCK_LOADING_TIMEOUT_MS's own comment: flips true if the splash
  // below has been showing too long, offering a manual way out of a cold
  // start that never resolves.
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      // A fresh login is its own authentication; the lock guards a resumed
      // session. Clearing on SIGNED_OUT (never on the initial null) also
      // releases a patient who used the lock screen's "Sign out" escape
      // hatch after losing biometrics at the OS level.
      if (event === "SIGNED_OUT") setLockState("unlocked");
    });
    return () => subscription.unsubscribe();
  }, []);

  // Split from the subscription above so a retry (bumping retryToken) can
  // re-issue just this call without tearing down and re-subscribing to auth
  // state changes. `active` guards against a retry firing while an earlier,
  // now-abandoned call is still in flight.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    return () => {
      active = false;
    };
  }, [retryToken]);

  useEffect(() => {
    readAppLockEnabled()
      .then((enabled) => setLockState(enabled ? "locked" : "unlocked"))
      .catch(() => setLockState("unlocked"));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        wentToBackground.current = true;
        return;
      }
      if (next === "active" && wentToBackground.current) {
        wentToBackground.current = false;
        // Re-read the preference rather than caching it: the toggle may have
        // been flipped in Settings since this app session started.
        readAppLockEnabled()
          .then((enabled) => {
            if (enabled) setLockState("locked");
          })
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!session?.user.id) {
      setIdentity(session === null ? null : undefined);
      return;
    }
    setIdentity(undefined);
    // A rejected fetch used to leave `identity` at `undefined` forever — an
    // unhandled rejection, and the splash screen below never repaints, since
    // nothing ever runs to change its render condition. Falling back to
    // `null` (same as "no identity record") lets the patient reach the
    // existing "not signed in" path instead of hanging silently.
    loadPatientIdentity(session.user.id)
      .then(setIdentity)
      .catch(() => setIdentity(null));
  }, [session, retryToken]);

  // A cold start (session, identity, or the app-lock preference all read
  // from native storage / network) has no upper bound on its own — any one
  // of those promises simply never settling left a patient staring at the
  // branded splash below forever, with nothing on screen to explain why and
  // no way to recover short of a full uninstall+reinstall. This was a real
  // gap regardless of trigger: `loadPatientIdentity` had no `.catch` at all
  // (a rejection left `identity` at `undefined` permanently, silently), and
  // even a successful-but-slow chain had no upper bound. Investigating a
  // reported blank-shell hang on cold relaunch, lldb showed the JS and main
  // threads both genuinely idle (not looping, not deadlocked) — consistent
  // with *some* native promise never calling back — but the specific
  // trigger could not be pinned down to app code: it kept reproducing even
  // with every plausible culprit (HealthKit calls included) disabled, and a
  // plain simulator reboot (no app change) made it disappear, which points
  // at simulator-host flakiness rather than a deterministic bug here. This
  // timeout is the safety net regardless of cause — it doesn't fix a flaky
  // host, but it stops a patient from ever being stuck on a silent screen
  // with no way back short of killing the app.
  useEffect(() => {
    const loading = session === undefined || (!!session && (identity === undefined || lockState === "unknown"));
    if (!loading) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), STUCK_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [session, identity, lockState, retryToken]);

  useEffect(() => {
    if (session && identity) {
      // registerBackgroundHealthSync is deferred a tick past the others:
      // found live in the OS log, once, during this investigation —
      // "Attempt to present <HKHealthPrivacyHostAuthorizationViewController>
      // ... whose view is not in the window hierarchy" — meaning HealthKit's
      // own authorisation sheet (presented natively by
      // configureBackgroundTypes/subscribeToChanges even when permission was
      // already granted) can be asked to present itself before this app's
      // root view has attached to the window on a cold launch. That
      // presentation would fail silently, and the native completion handler
      // the JS promise is awaiting would never fire. This is a real,
      // plausible risk worth avoiding cheaply — runAfterInteractions defers
      // until the current UI work (including the initial mount) is done, so
      // the root view is attached by the time this runs. It was NOT,
      // however, confirmed as the cause of the reproducible hang this
      // investigation was chasing: that hang still occurred with this call
      // disabled entirely, across different app builds, and turned out to
      // track simulator-host state (see STUCK_LOADING_TIMEOUT_MS's comment)
      // rather than this code path. Kept as cheap, harmless hardening for a
      // real native log warning, not as the fix for that hang. The other
      // calls below don't touch HealthKit and don't need this — deferring
      // everything would just delay a patient's push-token registration and
      // offline-queue flush for no reason.
      const healthSyncHandle = InteractionManager.runAfterInteractions(() => {
        // Fire-and-forget, but never unhandled: background health sync is a
        // best-effort enhancement, and a rejection here used to redbox the
        // app for every patient signing in under Expo Go (no Nitro native
        // module). Nothing the patient does depends on this resolving.
        registerBackgroundHealthSync().catch(() => {});
      });
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
      return () => healthSyncHandle.cancel();
    }
  }, [session, identity]);

  if (stuck) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.screen, gap: 12 }}>
        <StatusBar barStyle="dark-content" />
        <Ionicons name="refresh-circle-outline" size={40} color={colors.muted} />
        <Text style={{ fontSize: typeScale.title, fontWeight: "700", color: colors.ink, textAlign: "center" }}>
          This is taking longer than usual
        </Text>
        <MutedText>Signing you in is stuck. Your account is safe — try again.</MutedText>
        <View style={{ marginTop: 8 }}>
          <PrimaryButton
            title="Try again"
            onPress={() => {
              setStuck(false);
              setSession(undefined);
              setIdentity(undefined);
              setRetryToken((token) => token + 1);
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (session === undefined || (session && (identity === undefined || lockState === "unknown"))) {
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

  // The shell is gated behind the lock, not overlaid by it: while locked, no
  // patient data mounts at all, so nothing can leak under or behind the gate.
  if (lockState === "locked") {
    return <AppLockScreen onUnlocked={() => setLockState("unlocked")} />;
  }

  return (
    // Bottom excluded: BottomTabBar (inside HomeShell) insets its own bottom
    // edge, so a bottom inset here would double up the gesture-area padding.
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.card }} edges={["top", "left", "right"]}>
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

/**
 * Root gate: the very first Ionicons render anywhere in the app (TopBar's
 * menu/notification icons, since TopBar mounts before anything else) threw
 * "Cannot call a class as a function" and crashed the whole app — every
 * subsequent icon render (BottomTabBar etc.) worked fine, isolating this to
 * a one-time initialization issue in the icon font's own loading path
 * (createIconSet's underlying class only lazily calls Font.loadAsync on
 * first render — see @expo/vector-icons/build/createIconSet.js). Explicitly
 * loading the font here, before anything in the real app tree ever renders
 * an icon, avoids that first-render path entirely.
 *
 * This is the OUTERMOST gate in the app — AppContent's own stuck-loading
 * timeout (see STUCK_LOADING_TIMEOUT_MS) cannot help if this one never
 * settles, since AppContent never even mounts. `.catch().finally()` only
 * covers a rejection; a native call that neither resolves nor rejects
 * (found live: a cold-launch race between this and other native module
 * initialisation, e.g. HealthKit/Nitro, left both the JS and main threads
 * genuinely idle — not crashed, not looping, just waiting on a completion
 * handler that never fires) left `iconsReady` false forever with nothing on
 * screen to explain why. Same fix as AppContent's: race it against a
 * timeout so the app always proceeds.
 */
export default function App() {
  const [iconsReady, setIconsReady] = useState(false);

  useEffect(() => {
    let settled = false;
    const proceed = () => {
      if (settled) return;
      settled = true;
      setIconsReady(true);
    };
    Ionicons.loadFont()
      .catch(() => {})
      .finally(proceed);
    const timer = setTimeout(proceed, STUCK_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!iconsReady) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand }}>
          <StatusBar barStyle="light-content" />
          <ActivityIndicator color="#FFFFFF" />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
