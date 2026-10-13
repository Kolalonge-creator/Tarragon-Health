import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { recordSyncError } from "./sync-diagnostics";
import { classifyFailure } from "./outbox-rules";
import { countAllOutboxRows, flushOutbox } from "./outbox";
import { destroyStore } from "./secure-db";
import { getOrCreateDeviceId, resetDeviceId } from "./store-key";
import { addStoreNotice } from "./store-notices";
import { leaseVerdict, type WipeReason } from "./store-rules";

/**
 * Remote wipe and key lease (S06x, decision D3). The phone checks in whenever it syncs.
 *
 *  - The server answers with a revoked flag (a lost-phone report by the patient or an administrator) and
 *    a lease: the phone must reach the server again within offline_sync_config.device_lease_days (30,
 *    PROPOSED) or its key lease has run out.
 *  - Either way the phone first makes ONE last upload attempt, then removes the encrypted store, the key
 *    and every other local copy of health data, tells the patient in the app (a notice that survives the
 *    wipe), and tells the server how many entries had not gone (a count, never their content).
 *  - Never silent: the notice is written before the files are removed, and stays until dismissed.
 *
 * Known limit, recorded in docs/design/S06x.md: a phone clock that jumps forward cannot be told from time
 * passing, so a lease can end early. The last upload attempt is why that costs nothing when the network
 * is up, and the count sent to the server is why support can see when it did not.
 */
const STATE_KEY = "@tarragon/device-lease/v1";
const PENDING_CONFIRM_KEY = "@tarragon/device-wipe-confirm/v1";
/** Local keys that must outlive a wipe: the patient-facing notice, and the data-use meter (no health content). */
const KEEP_PREFIXES = ["@tarragon/store-notices/", "@tarragon/data-usage/", STATE_KEY, PENDING_CONFIRM_KEY];

interface LeaseState {
  leaseExpiresAt: string;
  lastCheckinClock: string;
  userId: string;
}

interface PendingConfirm {
  deviceId: string;
  unsent: number;
}

export type DeviceCheckOutcome = "ok" | "offline" | "wiped" | "skipped";

async function readState(userId: string): Promise<LeaseState | null> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LeaseState>;
    if (parsed.userId !== userId || typeof parsed.leaseExpiresAt !== "string" || typeof parsed.lastCheckinClock !== "string") return null;
    return parsed as LeaseState;
  } catch {
    return null;
  }
}

function asWipeReason(value: unknown): WipeReason {
  return value === "stolen" || value === "admin" || value === "lost_phone" ? value : "lost_phone";
}

/** Removes everything on the phone that holds health data. Order matters: the notice first, the store last. */
export async function wipeThisPhone(reason: WipeReason, deviceId: string, now: Date = new Date()): Promise<{ unsent: number }> {
  // 1. The one last upload attempt. A failure here is the expected case for a phone that is offline.
  try {
    await flushOutbox();
  } catch (error) {
    recordSyncError("offline_outbox", "wipe:lastFlush", error);
  }
  // 2. Count what did not go. The count is all the server ever hears about it.
  let unsent = 0;
  try {
    unsent = await countAllOutboxRows();
  } catch (error) {
    recordSyncError("offline_outbox", "wipe:count", error);
  }
  // 3. Tell the patient BEFORE anything is removed, so a crash half way still leaves the notice.
  await addStoreNotice({ kind: "wiped", reason, unsent }, now);
  await AsyncStorage.setItem(PENDING_CONFIRM_KEY, JSON.stringify({ deviceId, unsent } satisfies PendingConfirm)).catch(() => {});
  // 4. The store, its key, and every earlier generation.
  await destroyStore();
  // 5. Other local copies: the AsyncStorage queues and caches. Only the notices and the data meter stay.
  const keys = await AsyncStorage.getAllKeys();
  const doomed = keys.filter((k) => !KEEP_PREFIXES.some((p) => k.startsWith(p)));
  if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
  await AsyncStorage.removeItem(STATE_KEY).catch(() => {});
  // 6. A fresh id, so this phone registers as a new device the next time it checks in.
  await resetDeviceId(await currentUserIdOrEmpty());
  return { unsent };
}

async function currentUserIdOrEmpty(): Promise<string> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id ?? "";
  } catch {
    return "";
  }
}

async function sendPendingConfirm(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CONFIRM_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw) as PendingConfirm;
    const { error } = await supabase.rpc("confirm_offline_device_wipe", { p_device: pending.deviceId, p_unsent: pending.unsent });
    // P0002: the server has no such device for this account (another account is signed in now). Nothing more to tell it.
    if (!error || error.code === "P0002" || error.code === "42501") await AsyncStorage.removeItem(PENDING_CONFIRM_KEY);
    else recordSyncError("offline_outbox", "wipe:confirm", error.message);
  } catch (error) {
    recordSyncError("offline_outbox", "wipe:confirm", error);
  }
}

/**
 * One check-in. Safe to call often: it is one small request. Never throws. Call it after a flush, from the
 * foreground loop and the background task, for a signed-in patient.
 */
export async function runDeviceCheck(now: Date = new Date()): Promise<DeviceCheckOutcome> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return "skipped";
    await sendPendingConfirm();
    const deviceId = await getOrCreateDeviceId(userId);
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const { data, error } = await supabase.rpc("offline_device_checkin", { p_device: deviceId, p_platform: platform });

    if (error) {
      const cls = classifyFailure({ code: error.code, message: error.message });
      if (cls !== "network" && cls !== "retry") {
        recordSyncError("offline_outbox", "deviceCheckin", error.message);
        return "skipped";
      }
      const state = await readState(userId);
      if (leaseVerdict(state?.leaseExpiresAt ?? null, state?.lastCheckinClock ?? null, now) === "expired") {
        await wipeThisPhone("lease_expired", deviceId, now);
        return "wiped";
      }
      return "offline";
    }

    const answer = (data ?? {}) as { revoked?: boolean; lease_expires_at?: string; wipe_reason?: string };
    if (answer.revoked) {
      await wipeThisPhone(asWipeReason(answer.wipe_reason), deviceId, now);
      await sendPendingConfirm();
      return "wiped";
    }
    if (typeof answer.lease_expires_at === "string") {
      await AsyncStorage.setItem(
        STATE_KEY,
        JSON.stringify({ leaseExpiresAt: answer.lease_expires_at, lastCheckinClock: now.toISOString(), userId } satisfies LeaseState)
      );
    }
    return "ok";
  } catch (error) {
    recordSyncError("offline_outbox", "deviceCheck", error);
    return "skipped";
  }
}

const CHECK_MIN_INTERVAL_MS = 10 * 60_000;
let lastCheckAt = 0;

/** At most one check-in per ten minutes from the foreground loops (a small request, but no need to repeat it every minute). */
export async function runDeviceCheckThrottled(now: number = Date.now()): Promise<DeviceCheckOutcome> {
  if (now - lastCheckAt < CHECK_MIN_INTERVAL_MS) return "skipped";
  lastCheckAt = now;
  return runDeviceCheck(new Date(now));
}

/** Test hook. */
export function __resetDeviceCheckThrottle(): void {
  lastCheckAt = 0;
}

/** Patient report from a signed-in phone or the web: "this phone is lost". The phone wipes the next time it syncs. */
export async function reportPhoneLost(deviceId: string, reason: "lost_phone" | "stolen" = "lost_phone"): Promise<boolean> {
  const { error } = await supabase.rpc("request_offline_device_wipe", { p_device: deviceId, p_reason: reason });
  return !error;
}

/** The phones registered to the signed-in account, for a "my phones" list. */
export async function listMyPhones(): Promise<{ deviceId: string; platform: string; lastSeenAt: string; revoked: boolean }[]> {
  const { data, error } = await supabase
    .from("offline_device_leases")
    .select("device_id, platform, last_checkin_at, revoked_at")
    .order("last_checkin_at", { ascending: false });
  if (error || !data) return [];
  return data.map((d) => ({ deviceId: d.device_id, platform: d.platform, lastSeenAt: d.last_checkin_at, revoked: d.revoked_at !== null }));
}
