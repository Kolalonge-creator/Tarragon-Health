import { supabase } from "./supabase";
import type { ManagedDevice } from "./reading-subject";

/** Devices paired to the people the signed-in person manages, so a shared phone can list and open them. A failed load is `ok: false`, never an empty list. */
export async function loadManagedDevices(): Promise<{ ok: true; items: ManagedDevice[] } | { ok: false }> {
  try {
    const { data, error } = await supabase.rpc("devices_i_manage");
    if (error) return { ok: false };
    return {
      ok: true,
      items: (data ?? []).map((row) => ({
        id: row.id,
        patientId: row.patient_id,
        personName: row.person_name || "Someone you support",
        deviceType: row.device_type,
        bleDeviceId: row.ble_device_id,
        model: row.model ?? null,
        nickname: row.nickname ?? null,
        lastSyncedAt: row.last_synced_at ?? null,
      })),
    };
  } catch {
    return { ok: false };
  }
}

/** Pairs a found Bluetooth device to a person: their own through the ordinary insert, someone they manage through pair_device_for. */
export async function pairDeviceFor(
  person: { profileId: string; isSelf: boolean },
  device: { deviceType: string; bleDeviceId: string; model: string | null },
): Promise<{ ok: true; id: string } | { ok: false }> {
  try {
    const { data, error } = await supabase.rpc("pair_device_for", {
      p_person: person.profileId,
      p_device_type: device.deviceType as never,
      p_ble_device_id: device.bleDeviceId,
      p_model: device.model ?? undefined,
    });
    if (error || !data) return { ok: false };
    return { ok: true, id: data };
  } catch {
    return { ok: false };
  }
}
