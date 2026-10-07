import { supabase } from "./supabase";

/**
 * The Module 18 go-live switches as the phone sees them (INV-14, client side). Each is a platform_modules row, off until an admin switches it
 * on; the server refuses the matching call while it is off, so this only decides what the screens offer. Fail closed: a switch that cannot be
 * read is an OFF switch, so the phone offers nothing new rather than something the server will refuse.
 */
export type DeviceModuleKey =
  | "device_plausibility_hold"
  | "device_cross_source_dedupe"
  | "device_cgm_sustained_events"
  | "device_ecg_rhythm_alerts"
  | "device_photo_capture"
  | "device_recommended_list"
  | "device_wrist_spo2_informational";

export type DeviceFlags = Record<DeviceModuleKey, boolean>;

export const NO_DEVICE_FLAGS: DeviceFlags = {
  device_plausibility_hold: false,
  device_cross_source_dedupe: false,
  device_cgm_sustained_events: false,
  device_ecg_rhythm_alerts: false,
  device_photo_capture: false,
  device_recommended_list: false,
  device_wrist_spo2_informational: false,
};

export async function loadDeviceFlags(): Promise<DeviceFlags> {
  try {
    const { data, error } = await supabase.from("platform_modules").select("key, is_enabled").like("key", "device\\_%");
    if (error || !data) return { ...NO_DEVICE_FLAGS };
    const flags: DeviceFlags = { ...NO_DEVICE_FLAGS };
    for (const row of data) {
      if (row.key in flags) flags[row.key as DeviceModuleKey] = row.is_enabled === true;
    }
    return flags;
  } catch {
    return { ...NO_DEVICE_FLAGS };
  }
}
