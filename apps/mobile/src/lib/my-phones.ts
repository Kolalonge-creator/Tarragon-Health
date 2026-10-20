import { buildPhoneViews, parsePhoneRows, PHONE_COLUMNS, phoneUpdateArgs, type PhoneView } from "@tarragon/shared";
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
    const { data, error } = await supabase.from("offline_device_leases").select(PHONE_COLUMNS).order("last_checkin_at", { ascending: false }).limit(100);
    if (error || !Array.isArray(data)) return { ok: false };
    const { rows, dropped } = parsePhoneRows(data);
    return { ok: true, phones: buildPhoneViews(rows, now, thisPhoneId), dropped, thisPhoneId };
  } catch (e) {
    recordSyncError("offline_outbox", "loadPhones", e);
    return { ok: false };
  }
}

/** Never throws; false means nothing was saved. */
export async function savePhoneDetails(deviceId: string, change: { label?: string | null; shared?: boolean }): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("update_my_offline_device", phoneUpdateArgs(deviceId, change));
    return !error;
  } catch (e) {
    recordSyncError("offline_outbox", "savePhoneDetails", e);
    return false;
  }
}

export interface ThisPhoneUnsent {
  /** Entries for the signed-in account still not on the server after one last try. */
  unsent: number;
  urgent: number;
  /** Entries saved under OTHER accounts on this phone (counts only, never who). The wipe clears them too. */
  others: number;
}

/**
 * One last upload attempt, then the counts the patient sees before confirming. Never throws. When the count itself cannot be read it returns
 * `null`, which the screen shows as "we could not check", never as "everything has been sent".
 */
export async function lastTryAndCount(userId: string): Promise<ThisPhoneUnsent | null> {
  try {
    await flushOutbox();
  } catch (e) {
    recordSyncError("offline_outbox", "removePhoneFlush", e);
  }
  try {
    const all = await countUnsentByOwner();
    const mine = all.find((o) => o.owner === userId);
    const others = all.filter((o) => o.owner !== userId).reduce((n, o) => n + o.total, 0);
    return { unsent: mine?.total ?? 0, urgent: mine?.danger ?? 0, others };
  } catch (e) {
    recordSyncError("offline_outbox", "removePhoneCount", e);
    return null;
  }
}

export type RemoveOutcome =
  /** The request failed; nothing changed. */
  | "failed"
  /** This phone has cleared and signed out. */
  | "cleared"
  /** The request is filed; the phone clears the next time it connects (always the case for another phone). */
  | "filed"
  /** This phone's request is filed but its check-in did not reach the server, so it has NOT cleared yet. */
  | "filed_not_cleared";

/**
 * Asks for a phone to be cleared. For THIS phone the check-in runs straight away and its outcome is checked: only "wiped" counts as cleared.
 */
export async function removePhone(deviceId: string, isThisPhone: boolean): Promise<RemoveOutcome> {
  let ok = false;
  try {
    ok = await reportPhoneLost(deviceId, "lost_phone");
  } catch (e) {
    recordSyncError("offline_outbox", "removePhone", e);
  }
  if (!ok) return "failed";
  if (!isThisPhone) return "filed";
  const outcome = await runDeviceCheck();
  return outcome === "wiped" ? "cleared" : "filed_not_cleared";
}
