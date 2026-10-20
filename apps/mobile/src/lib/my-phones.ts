import { buildPhoneViews, parsePhoneRows, type PhoneView } from "@tarragon/shared";
import { supabase } from "./supabase";
import { recordSyncError } from "./sync-diagnostics";
import { countUnsentByOwner, flushOutbox } from "./outbox";
import { reportPhoneLost, runDeviceCheck } from "./device-lease";
import { getOrCreateDeviceId } from "./store-key";

/**
 * "My phones" on the phone (S06z). Own account only: the table's select policy is `account_id = auth.uid()`, and the screen does not ask
 * at all while a supporter is acting for someone else. A failed read is `{ ok: false }` so the screen can say so (and offer a retry)
 * instead of showing an empty list that reads as "no phones".
 */
export type PhonesResult = { ok: true; phones: PhoneView[]; dropped: number; thisPhoneId: string } | { ok: false };

export async function loadPhones(userId: string, now: Date = new Date()): Promise<PhonesResult> {
  try {
    const thisPhoneId = await getOrCreateDeviceId(userId);
    const { data, error } = await supabase
      .from("offline_device_leases")
      .select("device_id, platform, device_label, shared_phone, last_checkin_at, lease_expires_at, revoked_at, wipe_confirmed_at, unsent_at_wipe, danger_at_wipe, retired_at")
      .order("last_checkin_at", { ascending: false })
      .limit(100);
    if (error || !Array.isArray(data)) return { ok: false };
    const { rows, dropped } = parsePhoneRows(data);
    return { ok: true, phones: buildPhoneViews(rows, now, thisPhoneId), dropped, thisPhoneId };
  } catch (e) {
    recordSyncError("offline_outbox", "loadPhones", e);
    return { ok: false };
  }
}

export async function savePhoneDetails(deviceId: string, change: { label?: string | null; shared?: boolean }): Promise<boolean> {
  const { error } = await supabase.rpc("update_my_offline_device", {
    p_device: deviceId,
    ...(change.label ? { p_label: change.label } : {}),
    ...(change.label === null ? { p_clear_label: true } : {}),
    ...(change.shared !== undefined ? { p_shared: change.shared } : {}),
  });
  return !error;
}

export interface ThisPhoneUnsent {
  /** Entries on this phone, for the signed-in account, that have still not reached the server after one last try. */
  unsent: number;
  urgent: number;
}

/** One last upload attempt, then the counts the patient is shown before they confirm. Never throws; on failure it reports what it could count. */
export async function lastTryAndCount(userId: string): Promise<ThisPhoneUnsent> {
  try {
    await flushOutbox();
  } catch (e) {
    recordSyncError("offline_outbox", "removePhoneFlush", e);
  }
  try {
    const mine = (await countUnsentByOwner()).find((o) => o.owner === userId);
    return { unsent: mine?.total ?? 0, urgent: mine?.danger ?? 0 };
  } catch (e) {
    recordSyncError("offline_outbox", "removePhoneCount", e);
    return { unsent: 0, urgent: 0 };
  }
}

/**
 * Asks for a phone to be cleared. For THIS phone the check-in runs straight away, so it clears and signs out now (its own last attempt runs
 * inside the wipe); another phone clears the next time it connects. `false` means the request did not go and nothing changed.
 */
export async function removePhone(deviceId: string, isThisPhone: boolean): Promise<boolean> {
  const ok = await reportPhoneLost(deviceId, "lost_phone");
  if (!ok) return false;
  if (isThisPhone) await runDeviceCheck();
  return true;
}
