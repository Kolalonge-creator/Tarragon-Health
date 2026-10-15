import { Linking, Platform } from "react-native";
import type { MessageKey } from "@tarragon/i18n";
import { keepRemindersGroup, type KeepRemindersGroup } from "@tarragon/medicines";

/**
 * The "Keep reminders working" checklist (S08x, closes OQ-73): plain steps for the phone maker, and two buttons that open
 * the nearest settings screen. The steps are written from the vendors' public guidance and have not been checked on
 * real Tecno, Infinix, itel or Samsung hardware; the screens are named a little differently on each firmware, so the
 * wording stays general. Opening a screen is best effort and can never crash: on any failure the person is told where to look.
 */
export const KEEP_STEPS: Record<KeepRemindersGroup, readonly MessageKey[]> = {
  transsion: ["meds.keep.tecno_1", "meds.keep.tecno_2"],
  samsung: ["meds.keep.samsung_1", "meds.keep.samsung_2"],
  other_aggressive: ["meds.keep.generic_1"],
  generic: ["meds.keep.generic_1"],
};

export function keepStepsFor(manufacturer: string | null): readonly MessageKey[] {
  return KEEP_STEPS[keepRemindersGroup(manufacturer)];
}

export function androidManufacturer(): string | null {
  if (Platform.OS !== "android") return null;
  const m = (Platform.constants as { Manufacturer?: string } | undefined)?.Manufacturer;
  return typeof m === "string" && m.length > 0 ? m : null;
}

/** The list of apps with battery restrictions (not the "ignore battery optimisation" request, which Play restricts). */
export async function openBatterySettings(): Promise<boolean> {
  try {
    await Linking.sendIntent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS");
    return true;
  } catch {
    return openAppSettings();
  }
}

export async function openAppSettings(): Promise<boolean> {
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}
