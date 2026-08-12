import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";
import { supabase } from "./supabase";
import { configureIOSBackgroundDelivery, subscribeToIOSHealthChanges } from "./healthkit";
import { syncAppleHealth, syncHealthConnect } from "./health-sync";

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
 */

const TASK_NAME = "tarragon-health-background-sync";

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return BackgroundTask.BackgroundTaskResult.Success;

    if (Platform.OS === "ios") {
      await syncAppleHealth();
    } else if (Platform.OS === "android") {
      await syncHealthConnect();
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
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
  } catch {
    // Best-effort — a platform that refuses background execution (e.g. a
    // restrictive battery setting) should not block the rest of the app.
  }

  if (Platform.OS === "ios") {
    await configureIOSBackgroundDelivery();
    iosChangeSubscriptionRemove?.();
    iosChangeSubscriptionRemove = subscribeToIOSHealthChanges(() => {
      syncAppleHealth();
    });
  }
}
