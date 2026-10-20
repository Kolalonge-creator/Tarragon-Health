import AsyncStorage from "@react-native-async-storage/async-storage";
import { getConnectionKind } from "./connection-kind";
import type { ConnectionKind, UsageFigures } from "./data-cost-rules";

/**
 * A small meter of how much mobile data the app's own syncing used this month (S06x), so a patient on
 * a metered plan can see the cost of staying in sync. It counts what the sync code sends and receives
 * (payload sizes it already measures, plus a small fixed estimate per connectivity check); it is an
 * estimate, not the operating system's figure, and is labelled that way where shown.
 *
 * S06z splits the same count by connection: bytes used on mobile data are kept apart from Wi-Fi (free
 * on a data plan), and bytes the phone could not place are kept apart again and shown, never hidden.
 * The naira figure (data-cost-rules.ts) is worked out from the mobile part only.
 */
const PREFIX = "@tarragon/data-usage/";
// These stay under PREFIX so the remote wipe keeps them with the meter.
const MOBILE_PREFIX = `${PREFIX}mobile/`;
const UNPLACED_PREFIX = `${PREFIX}unplaced/`;
const LAST_KEY = `${PREFIX}last`;
/** Two uses of data this close together are one sync (a flush sends many rows, a pull reads many pages). */
const SAME_SYNC_GAP_MS = 60_000;

export function monthKey(now: Date): string {
  return `${PREFIX}${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

let chain: Promise<void> = Promise.resolve();

/** Reads a stored byte count; a missing or corrupt value is zero. */
async function readCount(key: string): Promise<number> {
  const raw = await AsyncStorage.getItem(key);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Adds bytes to this month's total, and to the mobile-data or unplaced part when that is where they went.
 * Serialised so concurrent syncs do not lose counts. Never throws. `connection` is read from the phone
 * when not given.
 */
export function addDataUsage(bytes: number, now: Date = new Date(), connection?: ConnectionKind): Promise<void> {
  if (!Number.isFinite(bytes) || bytes <= 0) return Promise.resolve();
  chain = chain.then(async () => {
    try {
      const key = monthKey(now);
      await AsyncStorage.setItem(key, String(Math.round((await readCount(key)) + bytes)));
      // Wi-Fi and "no connection" cost nothing on a data plan; mobile data counts; what we cannot tell is kept apart.
      const kind = connection ?? (await getConnectionKind());
      const part = kind === "cellular" ? MOBILE_PREFIX : kind === "unknown" ? UNPLACED_PREFIX : null;
      if (part !== null) {
        const partKey = `${part}${key.slice(PREFIX.length)}`;
        await AsyncStorage.setItem(partKey, String(Math.round((await readCount(partKey)) + bytes)));
      }
      await noteLastSync(bytes, part !== null, now.getTime());
    } catch {
      // a meter that cannot count must never get in the way of syncing
    }
  });
  return chain;
}

interface LastSync {
  startedAt: number;
  updatedAt: number;
  /** What this sync used on mobile data (or could not place). */
  bytes: number;
}

function parseLast(raw: string | null): LastSync | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<LastSync>;
    if (typeof p.startedAt === "number" && typeof p.updatedAt === "number" && typeof p.bytes === "number") {
      return { startedAt: p.startedAt, updatedAt: p.updatedAt, bytes: p.bytes };
    }
  } catch {
    // a corrupt record starts a new sync
  }
  return null;
}

async function noteLastSync(bytes: number, counted: boolean, nowMs: number): Promise<void> {
  const last = parseLast(await AsyncStorage.getItem(LAST_KEY));
  const add = counted ? bytes : 0;
  const sameSync = last !== null && nowMs >= last.updatedAt && nowMs - last.updatedAt <= SAME_SYNC_GAP_MS;
  const next: LastSync =
    sameSync && last
      ? { startedAt: last.startedAt, updatedAt: nowMs, bytes: Math.round(last.bytes + add) }
      : { startedAt: nowMs, updatedAt: nowMs, bytes: Math.round(add) };
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify(next));
}

export async function getMonthlyDataUsage(now: Date = new Date()): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(monthKey(now));
    return (raw ? Number(raw) : 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * The figures the meter shows: this month's use on mobile data (plus use we could not place, counted in
 * the same figure so the estimate leans high rather than low, and reported apart so it is never hidden),
 * and the last sync's. Never throws; a failed read is zeros.
 */
export async function getUsageFigures(now: Date = new Date()): Promise<UsageFigures> {
  try {
    const month = monthKey(now).slice(PREFIX.length);
    const [mobile, unplaced] = await Promise.all([readCount(`${MOBILE_PREFIX}${month}`), readCount(`${UNPLACED_PREFIX}${month}`)]);
    const last = parseLast(await AsyncStorage.getItem(LAST_KEY));
    return {
      monthBytes: mobile + unplaced,
      unplacedBytes: unplaced,
      lastSync: last ? { bytes: last.bytes, at: last.updatedAt } : null,
    };
  } catch {
    return { monthBytes: 0, unplacedBytes: 0, lastSync: null };
  }
}

/** "1.2 MB", "340 KB", "0 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}
