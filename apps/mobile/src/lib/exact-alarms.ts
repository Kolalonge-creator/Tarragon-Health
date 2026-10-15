import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

/**
 * Android exact alarms (S08x, closes OQ-73), behind a wrapper that can never throw.
 *
 * The native half is the local module in apps/mobile/modules/exact-alarms. It exists only in a native build made after
 * this change, so on an older binary (or iOS, or a test) `requireOptionalNativeModule` returns null and every answer here
 * is "cannot tell", which shows no warning and no button rather than a wrong one. The reminders themselves still work
 * either way; exact alarms only decide whether they can arrive a few minutes late.
 */
interface ExactAlarmsNative {
  canScheduleExactAlarms(): boolean;
  openExactAlarmSettings(): boolean;
}

function native(): ExactAlarmsNative | null {
  if (Platform.OS !== "android") return null;
  try {
    return requireOptionalNativeModule<ExactAlarmsNative>("ExactAlarms");
  } catch {
    return null;
  }
}

/** True: allowed (or the phone is older than Android 12). False: not allowed. Null: not Android, or this build cannot tell. */
export function exactAlarmsAllowed(): boolean | null {
  const mod = native();
  if (!mod) return null;
  try {
    return mod.canScheduleExactAlarms() === true;
  } catch {
    return null;
  }
}

/** Opens the system screen where exact alarms can be allowed. False if it could not be opened. */
export function openExactAlarmSettings(): boolean {
  const mod = native();
  if (!mod) return false;
  try {
    return mod.openExactAlarmSettings() === true;
  } catch {
    return false;
  }
}
