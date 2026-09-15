import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import { supabase } from "./supabase";
import { configureIOSBackgroundDelivery, subscribeToIOSHealthChanges } from "./healthkit";
import { syncAppleHealth, syncHealthConnect } from "./health-sync";
import { flushDeviceReadingsQueue } from "./offline-queue";
import { recordSyncError } from "./sync-diagnostics";
import { flushPendingVitals } from "./offline-vitals-queue";
import { syncThresholdsIfOnline } from "./threshold-sync";

/**
 * The reliable background-sync backbone for both platforms.
 *
 * Neither platform's native "wake on health data change" mechanism is
 * something this app can lean on alone:
 * - Android Health Connect has no wake-on-write mechanism at all — its API
 *   is poll-only (see health-connect.ts's own doc comment).
 * - iOS HealthKit's native background delivery genuinely wakes the app
 *   process (healthkit.ts's configureIOSBackgroundDelivery), but the
 *   installed @kingstinct/react-native-healthkit version never wires that
 *   wake to a JS callback — see that function's own comment for the
 *   specifics of what was actually confirmed by reading the library's
 *   native source.
 *
 * expo-background-task (BGTaskScheduler on iOS, WorkManager on Android,
 * one JS API) is the one mechanism Expo genuinely ships a working native ->
 * JS invocation contract for on both platforms, so it's the backbone here,
 * not a fallback. iOS additionally gets subscribeToIOSHealthChanges wired
 * up for a faster, live-while-JS-is-running sync on top of it.
 *
 * `minimumInterval` is a floor, not a schedule — both OSes decide the real
 * cadence, and iOS in particular often defers to an overnight window. A
 * patient should still see a fresh reading from the manual "Sync" button on
 * the Devices tab; this task is the "usually don't have to think about it"
 * layer on top; see MOBILE_APP_SPEC.md/CLAUDE.md for the same caveat this
 * project applies to every other native path that has never run on real
 * hardware yet.
 *
 * This periodic run is also the reliable backstop for offline-queue.ts's two
 * store-and-forward queues (spec 55.13-55.15): whatever a page/reading
 * upload failed to send while the app wasn't running gets retried here at
 * the next OS-scheduled run, on top of the flush every manual sync and BLE
 * screen open already attempts. There is deliberately no NetInfo-driven
 * "flush immediately on reconnect" listener layered on top of that —
 * @react-native-community/netinfo is not a dependency anywhere in this app
 * today, and adding it solely for that one trigger was judged not worth a
 * new native dependency when this task's floor (15 minutes) plus a manual
 * sync/BLE screen open already recovers a queued item promptly in practice.
 * Revisit if NetInfo is ever added for another reason.
 */

const TASK_NAME = "tarragon-health-background-sync";

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return BackgroundTask.BackgroundTaskResult.Success;

    // BLE device readings (BP cuff, glucometer, etc.) have no health-store
    // sync call of their own to piggyback a queue flush on — syncAppleHealth/
    // syncHealthConnect below already flush their own health-samples queue
    // internally on every call, but this is the only place that retries a
    // reading queued by sync-screen.tsx after a failed upload; see
    // offline-queue.ts.
    const deviceReadingsFlush = await flushDeviceReadingsQueue();

    // Unconditional, unlike the platform-specific health sync below — the
    // offline vitals queue (offline-vitals-queue.ts) and the threshold
    // version check (threshold-sync.ts) apply to both platforms equally,
    // and are the "usually don't have to think about it" layer for the
    // Vitals screen's own opportunistic flush-on-save/flush-on-mount.
    try {
      await flushPendingVitals();
      await syncThresholdsIfOnline();
    } catch (error) {
      recordSyncError("offline_vitals", `${Platform.OS}:backgroundFlush`, error);
    }

    const result =
      Platform.OS === "ios"
        ? await syncAppleHealth()
        : Platform.OS === "android"
          ? await syncHealthConnect()
          : null;

    // A HealthSyncResult of "error", or a device-readings flush that made no
    // progress despite having a backlog, is a real failure even though
    // nothing threw — reporting it as Failed (not Success) matters beyond
    // logging: it's the signal BGTaskScheduler/WorkManager use to back off
    // retry timing, so treating a silent sync failure as "succeeded" would
    // make the OS trust a run that accomplished nothing. A flush that made
    // *some* progress (flushed > 0) before hitting a later failure is not
    // treated as a failure here, matching how a "partial" health sync isn't
    // either — offline_queue.ts's own flush already recorded the error.
    const deviceReadingsStuck = deviceReadingsFlush.flushed === 0 && deviceReadingsFlush.remaining > 0;
    if (result?.status === "error") {
      recordSyncError("background_sync", `${Platform.OS}:run`, result.message);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
    if (deviceReadingsStuck) {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    recordSyncError("background_sync", `${Platform.OS}:run`, error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

let iosChangeSubscriptionRemove: (() => void) | null = null;

/**
 * Call once the patient is signed in (App.tsx, after session + identity
 * resolve). Idempotent — expo-background-task's own registerTaskAsync
 * persists the registration, so calling this again on every app open is
 * the documented, safe pattern rather than something to guard against.
 */
export async function registerBackgroundHealthSync(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 15 });
  } catch (error) {
    // Best-effort — a platform that refuses background execution (e.g. a
    // restrictive battery setting) should not block the rest of the app —
    // but still worth recording: a registration failure here means the
    // periodic task never runs at all, which otherwise looks identical to
    // "it's running, just found nothing to sync."
    recordSyncError("background_sync", `${Platform.OS}:registerTaskAsync`, error);
  }

  if (Platform.OS === "ios") {
    // Every HealthKit entry point here has to be treated as throwing, not
    // just as returning nothing useful. The library binds its native module
    // eagerly (Nitro), and in Expo Go — where that binary does not exist —
    // the failure escaped loadHealthkit()'s own try/catch and surfaced as an
    // unhandled rejection, which LogBox renders as a full-screen "Uncaught
    // Error: NitroModules are not supported in Expo Go". That redbox landed
    // the moment a patient signed in, because App.tsx calls this on session
    // resolve, and it re-appeared as fast as you could dismiss it.
    //
    // Belt and braces on purpose: this guard, and a .catch() at the call
    // site. HealthKit genuinely is unavailable in Expo Go, so the correct
    // behaviour is to degrade to "no Apple Health sync" silently, exactly as
    // the rest of this module already assumed it would.
    try {
      await configureIOSBackgroundDelivery();
      iosChangeSubscriptionRemove?.();
      iosChangeSubscriptionRemove = subscribeToIOSHealthChanges(() => {
        syncAppleHealth();
      });
    } catch {
      iosChangeSubscriptionRemove = null;
    }
  }
}
