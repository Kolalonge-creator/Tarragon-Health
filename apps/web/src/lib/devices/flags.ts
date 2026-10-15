import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * The per-capability go-live switches for Module 18 (INV-14). Each is a row in `platform_modules`, off until an admin switches it on with a
 * reason. Everything new in S70a reads one of these, so shipping the code changes nothing a person can see until a switch is turned.
 *
 * Fail closed: an unreadable switch is an OFF switch. That keeps today's behaviour, which is the safe direction for a new capability
 * (the exception, the wrist SpO2 switch, is enforced in the database, not here).
 */
export const DEVICE_MODULE_KEYS = [
  "device_plausibility_hold",
  "device_cross_source_dedupe",
  "device_cgm_sustained_events",
  "device_ecg_rhythm_alerts",
  "device_photo_capture",
  "device_recommended_list",
  "device_wrist_spo2_informational",
] as const;

export type DeviceModuleKey = (typeof DEVICE_MODULE_KEYS)[number];
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

export async function readDeviceFlags(supabase: SupabaseClient<Database>): Promise<DeviceFlags> {
  try {
    const { data, error } = await supabase
      .from("platform_modules")
      .select("key, is_enabled")
      .in("key", [...DEVICE_MODULE_KEYS]);
    if (error || !data) return { ...NO_DEVICE_FLAGS };
    const flags: DeviceFlags = { ...NO_DEVICE_FLAGS };
    for (const row of data) {
      if ((DEVICE_MODULE_KEYS as readonly string[]).includes(row.key)) flags[row.key as DeviceModuleKey] = row.is_enabled === true;
    }
    return flags;
  } catch {
    return { ...NO_DEVICE_FLAGS };
  }
}

/** True once any Module 18 capability is switched on. The device.synced event is only emitted from then on, so shipping the code adds no outbox rows. */
export function anyDeviceModuleOn(flags: DeviceFlags): boolean {
  return DEVICE_MODULE_KEYS.some((key) => flags[key]);
}
