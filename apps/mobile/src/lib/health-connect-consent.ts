import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Whether the patient has been shown TarragonHealth's own Health Connect
 * permissions-rationale screen (health-connect-rationale-modal.tsx) and
 * chosen to continue, at least once.
 *
 * This is the piece HealthKit's side of the bridge (healthkit.ts) never
 * needed: on iOS, the `NSHealthShareUsageDescription` string in app.json
 * plus Apple's own permission sheet are the whole rationale contract, so
 * `requestHealthKitPermissions()` calls straight through. Health Connect is
 * different — Google's guidance (and the Play Health Connect declaration
 * form referenced in docs/PLAY_STORE_SUBMISSION.md) expects the requesting
 * app to explain what it reads and link to a privacy policy in its OWN UI
 * before the OS permission request fires, not merely declare a permission
 * string. `health-connect.ts`'s `requestHealthConnectPermissions()` checks
 * this flag before ever calling the native `requestPermission()`.
 *
 * Persisted rather than re-derived from `getGrantedPermissions()`, for two
 * reasons: a patient who is shown the rationale and then denies every
 * permission in Health Connect's own screen still should not be shown the
 * rationale again on every sync attempt; and this flag is what keeps
 * `requestHealthConnectPermissions()` safe to call unconditionally from a
 * headless background sync run (background-sync.ts's periodic
 * expo-background-task), which has no UI to show a rationale screen in at
 * all — before the patient has ever accepted it in the foreground, a
 * background run simply reads whatever is currently granted (nothing, on a
 * first install) instead of trying to pop OS permission UI from the
 * background.
 */
const RATIONALE_ACCEPTED_KEY = "@tarragon/health-connect/rationale-accepted/v1";

export async function hasAcceptedHealthConnectRationale(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(RATIONALE_ACCEPTED_KEY)) === "true";
  } catch {
    // Fails closed for this specific gate: if storage can't be read, treat
    // the rationale as not yet shown rather than silently skipping straight
    // to the OS permission request.
    return false;
  }
}

export async function markHealthConnectRationaleAccepted(): Promise<void> {
  try {
    await AsyncStorage.setItem(RATIONALE_ACCEPTED_KEY, "true");
  } catch {
    // Best-effort: worst case the rationale screen shows again next time,
    // which is a minor annoyance, not a safety or consent issue.
  }
}
