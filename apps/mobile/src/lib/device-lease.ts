import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { recordSyncError } from "./sync-diagnostics";
import { classifyFailure } from "./outbox-rules";
import { countDangerUnsent, countUnsentByOwner, flushOutbox } from "./outbox";
import { destroyStore } from "./secure-db";
import { forgetAllDeviceIds, getOrCreateDeviceId, listDeviceAccounts } from "./store-key";
import { addStoreNotice } from "./store-notices";
import { leaseVerdict, type WipeReason } from "./store-rules";
import { loadOfflineTrustConfig } from "./offline-trust-config";

/**
 * Remote wipe and key lease (S06x, decision D3, refined for urgent entries). The phone checks in whenever it syncs.
 *
 *  - Lost-phone report (the patient for their own phone, or an administrator): the server says "revoked". The phone
 *    makes ONE last upload attempt, then removes the encrypted store, the key and every other local copy of health
 *    data, tells the patient in the app, and tells the server how many entries had not gone.
 *  - Key lease: the phone must reach the server within offline_sync_config.device_lease_days (30, PROPOSED). A lapsed
 *    lease wipes the same way, with two protections the lost-phone report does not need:
 *      1. it is judged on the SERVER's clock. Check-in returns what the server held before renewing; a phone whose own
 *         clock jumped forward is renewed, not wiped. Offline, the phone's own record only starts a grace period
 *         (lease_grace_hours); the wipe waits until that has run, and a clock that went backwards never counts.
 *      2. it never happens while any urgent (danger-flagged) entry is unsent, for any account on the phone. That
 *         refines D3 for urgent rows: only an explicit lost-phone report wipes those, after its last attempt.
 *  - Counts, never content: every account on the phone gets its own notice and its own confirmation to the server,
 *    delivered the next time THAT account signs in (the server only accepts a confirmation from the owner).
 *  - Never silent: the notices are written before the files are removed and stay until dismissed.
 */
const STATE_KEY = "@tarragon/device-lease/v1";
const PENDING_CONFIRM_KEY = "@tarragon/device-wipe-confirm/v1";
/** Local keys that must outlive a wipe: the patient-facing notices, the data-use meter, and the lease and confirmation records (no health content). */
const KEEP_PREFIXES = ["@tarragon/store-notices/", "@tarragon/data-usage/", STATE_KEY, PENDING_CONFIRM_KEY];
const PENDING_MAX_AGE_MS = 90 * 86_400_000;

interface LeaseState {
  leaseExpiresAt: string;
  lastCheckinClock: string;
  userId: string;
  deviceId: string;
  leaseDays: number;
  /** When THIS phone first saw its own lease as lapsed while it could not ask the server. Starts the grace period. */
  expiredObservedAt?: string;
}

type ConfirmReason = WipeReason | "shared_phone";

interface PendingConfirm {
  userId: string;
  deviceId: string;
  unsent: number;
  danger: number;
  reason: ConfirmReason;
  at: string;
}

export type DeviceCheckOutcome = "ok" | "offline" | "wiped" | "held" | "skipped";

/** The last lease the server gave this phone. A property of the phone, not of whoever is signed in now. */
async function readState(): Promise<LeaseState | null> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LeaseState>;
    if (typeof parsed.leaseExpiresAt !== "string" || typeof parsed.lastCheckinClock !== "string" || typeof parsed.deviceId !== "string") return null;
    return parsed as LeaseState;
  } catch {
    return null;
  }
}

async function writeState(state: LeaseState): Promise<void> {
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function asWipeReason(value: unknown): WipeReason {
  return value === "stolen" || value === "admin" || value === "lost_phone" ? value : "lost_phone";
}

async function readPending(): Promise<PendingConfirm[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CONFIRM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingConfirm[]).filter((p) => typeof p?.userId === "string" && typeof p?.deviceId === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Removes everything on the phone that holds health data. Order matters: the notices and the pending confirmations
 * first, the store last. `triggerUserId` is the account whose device was revoked or whose lease ran out.
 */
export async function wipeThisPhone(
  reason: WipeReason,
  triggerUserId: string | null,
  now: Date = new Date(),
  days?: number
): Promise<{ unsent: number; danger: number }> {
  // 1. The one last upload attempt. A failure here is the expected case for a phone that is offline.
  try {
    await flushOutbox();
  } catch (error) {
    recordSyncError("offline_outbox", "wipe:lastFlush", error);
  }
  // 2. Count what did not go, per account on the phone. Counts are all anyone ever hears about it.
  let owners: Awaited<ReturnType<typeof countUnsentByOwner>> = [];
  try {
    owners = await countUnsentByOwner();
  } catch (error) {
    recordSyncError("offline_outbox", "wipe:count", error);
  }
  const accounts = await listDeviceAccounts();
  const everyone = new Set<string>([...Object.keys(accounts), ...owners.map((o) => o.owner)]);
  if (triggerUserId) everyone.add(triggerUserId);
  const counts = (userId: string) => owners.find((o) => o.owner === userId) ?? { owner: userId, total: 0, danger: 0 };

  // 3. Tell each account BEFORE anything is removed, so a crash half way still leaves the notices.
  const pending: PendingConfirm[] = [...(await readPending())];
  for (const userId of everyone) {
    const c = counts(userId);
    await addStoreNotice({ kind: "wiped", reason, unsent: c.total, ownerUserId: userId, ...(days ? { days } : {}) }, now);
    const deviceId = accounts[userId];
    if (deviceId) {
      pending.push({ userId, deviceId, unsent: c.total, danger: c.danger, reason: userId === triggerUserId ? reason : "shared_phone", at: now.toISOString() });
    }
  }
  await AsyncStorage.setItem(PENDING_CONFIRM_KEY, JSON.stringify(pending)).catch(() => {});
  // 4. The store, its key, and every earlier generation. A failure leaves the revoked flag in place, so it is retried.
  await destroyStore();
  // 5. Fresh ids for EVERY account known on this phone (signed in or not), so each registers as a new device next time.
  //    Before the sweep below, which would otherwise remove the list of accounts first.
  await forgetAllDeviceIds();
  // 6. Other local copies: the AsyncStorage queues and caches. Only the notices, the meter and the lease records stay.
  const keys = await AsyncStorage.getAllKeys();
  const doomed = keys.filter((k) => !KEEP_PREFIXES.some((p) => k.startsWith(p)));
  if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
  await AsyncStorage.removeItem(STATE_KEY).catch(() => {});
  return { unsent: owners.reduce((n, o) => n + o.total, 0), danger: owners.reduce((n, o) => n + o.danger, 0) };
}

/**
 * After the wipe: tell the server what this session may tell it (it needs the session, so this comes BEFORE the
 * sign-out), then sign out. The session lives in the keystore, not in the store: a lost phone that stayed signed in
 * would simply download the record again. The wipe is of the whole phone, every account on it.
 */
async function finishWipe(): Promise<void> {
  await sendPendingConfirm();
  await supabase.auth.signOut({ scope: "local" }).catch((error: unknown) => recordSyncError("offline_outbox", "wipe:signOut", error));
}

/**
 * Delivers the confirmations that belong to the account signed in now. Others wait for their own account. An entry is
 * dropped when the server took it, when it has no such device (P0002), or after 90 days; any other answer keeps it.
 */
async function sendPendingConfirm(): Promise<void> {
  try {
    const pending = await readPending();
    if (pending.length === 0) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    const keep: PendingConfirm[] = [];
    for (const p of pending) {
      if (Date.now() - new Date(p.at).getTime() > PENDING_MAX_AGE_MS) continue;
      if (!userId || p.userId !== userId) {
        keep.push(p);
        continue;
      }
      const { error } = await supabase.rpc("confirm_offline_device_wipe", {
        p_device: p.deviceId,
        p_unsent: p.unsent,
        p_danger: p.danger,
        p_reason: p.reason,
      });
      if (error && error.code !== "P0002") {
        recordSyncError("offline_outbox", "wipe:confirm", error.message);
        keep.push(p);
      }
    }
    if (keep.length === 0) await AsyncStorage.removeItem(PENDING_CONFIRM_KEY);
    else await AsyncStorage.setItem(PENDING_CONFIRM_KEY, JSON.stringify(keep));
  } catch (error) {
    recordSyncError("offline_outbox", "wipe:confirm", error);
  }
}

/**
 * A lapsed lease ends in a wipe only after one last upload attempt and only when no urgent entry is still unsent, for
 * any account on the phone. Returns "held" when an urgent entry is waiting: the lost-phone report is the only thing
 * that clears those.
 */
async function wipeForExpiredLease(state: LeaseState, now: Date): Promise<DeviceCheckOutcome> {
  try {
    await flushOutbox();
  } catch (error) {
    recordSyncError("offline_outbox", "lease:lastFlush", error);
  }
  if ((await countDangerUnsent()) > 0) {
    recordSyncError("offline_outbox", "lease:heldForUrgentEntries", "lease lapsed but an urgent entry is unsent");
    return "held";
  }
  await wipeThisPhone("lease_expired", state.userId, now, state.leaseDays);
  await finishWipe();
  return "wiped";
}

/**
 * The phone cannot ask the server (offline, signed out, or over its phone cap). Its own lease record may only start a
 * grace period; the wipe waits until that has run. A forward clock jump therefore costs a day of waiting, and the first
 * time the server is reachable it settles the matter on its own clock.
 */
async function judgeOfflineExpiry(state: LeaseState, now: Date): Promise<DeviceCheckOutcome> {
  if (leaseVerdict(state.leaseExpiresAt, state.lastCheckinClock, now) !== "expired") return "offline";
  const graceMs = loadOfflineTrustConfig().leaseGraceHours * 3_600_000;
  if (!state.expiredObservedAt) {
    await writeState({ ...state, expiredObservedAt: now.toISOString() });
    return "offline";
  }
  const since = now.getTime() - new Date(state.expiredObservedAt).getTime();
  if (since < graceMs) return "offline"; // also covers a clock that moved backwards (negative)
  return wipeForExpiredLease(state, now);
}

/**
 * One check-in. Safe to call often: it is one small request. Never throws. Call it after a flush, from the
 * foreground loop and the background task, for a signed-in patient.
 */
export async function runDeviceCheck(now: Date = new Date()): Promise<DeviceCheckOutcome> {
  try {
    const state = await readState();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return state ? await judgeOfflineExpiry(state, now) : "skipped";

    await sendPendingConfirm();
    const deviceId = await getOrCreateDeviceId(userId);
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const { data, error } = await supabase.rpc("offline_device_checkin", { p_device: deviceId, p_platform: platform });

    if (error) {
      const cls = classifyFailure({ code: error.code, message: error.message });
      // 53400: this account already has the most phones it may register. The server did not answer about THIS phone, so
      // it is handled like an outage (the phone's own lease record applies), never skipped silently.
      const overCap = error.code === "53400";
      if (!overCap && cls !== "network" && cls !== "retry") {
        recordSyncError("offline_outbox", "deviceCheckin", error.message);
        return "skipped";
      }
      if (overCap) recordSyncError("offline_outbox", "deviceCheckin:overCap", error.message);
      // A server fault (5xx) says nothing about the phone and does not start or advance the grace period.
      if (cls === "retry" && !overCap) return "offline";
      return state ? await judgeOfflineExpiry(state, now) : "offline";
    }

    const answer = (data ?? {}) as {
      revoked?: boolean;
      lease_expires_at?: string;
      lease_days?: number;
      wipe_reason?: string;
      server_now?: string;
      prev_lease_expires_at?: string | null;
    };
    if (answer.revoked) {
      await wipeThisPhone(asWipeReason(answer.wipe_reason), userId, now);
      await finishWipe();
      return "wiped";
    }

    const leaseDays = typeof answer.lease_days === "number" ? answer.lease_days : loadOfflineTrustConfig().deviceLeaseDays;
    const renewed: LeaseState | null =
      typeof answer.lease_expires_at === "string"
        ? { leaseExpiresAt: answer.lease_expires_at, lastCheckinClock: now.toISOString(), userId, deviceId, leaseDays }
        : null;

    // The server's own verdict on the lease it held BEFORE this check-in renewed it, on the server's clock.
    const lapsedOnServer =
      typeof answer.prev_lease_expires_at === "string" &&
      typeof answer.server_now === "string" &&
      Date.parse(answer.prev_lease_expires_at) <= Date.parse(answer.server_now);
    if (lapsedOnServer) {
      const outcome = await wipeForExpiredLease(
        { leaseExpiresAt: answer.prev_lease_expires_at as string, lastCheckinClock: now.toISOString(), userId, deviceId, leaseDays },
        now
      );
      if (outcome === "wiped") return outcome;
      if (renewed) await writeState(renewed);
      return outcome;
    }
    if (renewed) await writeState(renewed); // also clears any grace period the phone had started
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
    .is("retired_at", null)
    .order("last_checkin_at", { ascending: false });
  if (error || !data) return [];
  return data.map((d) => ({ deviceId: d.device_id, platform: d.platform, lastSeenAt: d.last_checkin_at, revoked: d.revoked_at !== null }));
}
