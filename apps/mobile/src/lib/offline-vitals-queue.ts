import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { NETWORK_ERROR_MESSAGE, postVitalReading, type VitalReadingPayload } from "./api";
import { recordSyncError } from "./sync-diagnostics";

/**
 * Local-first write queue for the native Vitals quick-log — the highest-
 * frequency write in the app (MOBILE_APP_SPEC.md §2.2) and one of the three
 * screens §6 requires to work with zero signal. A reading is inserted here
 * the instant it's logged, before any network call, so nothing is ever lost
 * to a dropped connection; flushPendingVitals() drains it later (called
 * opportunistically after every enqueue and from the shared background task
 * in background-sync.ts).
 *
 * client_reading_id is generated on-device and carried through to
 * POST /api/mobile/vitals, which treats a replay of the same id as an
 * idempotent no-op (vitals_readings_client_dedupe_idx) — see that route's
 * own comment. This is what makes flushPendingVitals() safe to retry blind
 * after a request that may or may not have actually landed.
 */

interface PendingVitalRow {
  client_reading_id: string;
  payload: string;
  beneficiary_profile_id: string | null;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("tarragon-offline.db").then(async (db) => {
      await db.execAsync(
        `create table if not exists pending_vitals (
          client_reading_id text primary key,
          payload text not null,
          beneficiary_profile_id text,
          created_at text not null,
          attempts integer not null default 0,
          last_error text
        );`
      );
      return db;
    });
  }
  return dbPromise;
}

export interface QueuedVital {
  clientReadingId: string;
  payload: VitalReadingPayload;
  beneficiaryProfileId?: string;
  createdAt: string;
}

/** Instant, zero-network write — the reading is durable on-device the
 * moment this resolves, regardless of connectivity. */
export async function enqueueVitalReading(
  payload: VitalReadingPayload,
  beneficiaryProfileId?: string
): Promise<QueuedVital> {
  const db = await getDb();
  const clientReadingId = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    "insert into pending_vitals (client_reading_id, payload, beneficiary_profile_id, created_at, attempts, last_error) values (?, ?, ?, ?, 0, null)",
    [clientReadingId, JSON.stringify(payload), beneficiaryProfileId ?? null, createdAt]
  );
  return { clientReadingId, payload, beneficiaryProfileId, createdAt };
}

export async function getPendingVitals(): Promise<QueuedVital[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PendingVitalRow>("select * from pending_vitals order by created_at asc");
  return rows.map((row) => ({
    clientReadingId: row.client_reading_id,
    payload: JSON.parse(row.payload) as VitalReadingPayload,
    beneficiaryProfileId: row.beneficiary_profile_id ?? undefined,
    createdAt: row.created_at,
  }));
}

export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>("select count(*) as count from pending_vitals");
  return row?.count ?? 0;
}

export interface FlushResult {
  synced: number;
  remaining: number;
  /** true when the flush stopped early because a request never reached the
   * server at all — a strong signal the device is genuinely offline, so
   * hammering the rest of the queue wouldn't help. */
  stoppedOffline: boolean;
}

/** Drains the queue oldest-first. A network-level failure (no response at
 * all) stops the whole run — the rest of the queue is left for the next
 * attempt rather than retried immediately against a connection that's
 * clearly down. A server-side error on one row is recorded and the run
 * continues to the next row, so one bad reading can't block the rest. */
export async function flushPendingVitals(): Promise<FlushResult> {
  const db = await getDb();
  const pending = await getPendingVitals();
  let synced = 0;

  for (const item of pending) {
    const result = await postVitalReading(item.payload, item.beneficiaryProfileId, item.clientReadingId);
    if (result.success) {
      await db.runAsync("delete from pending_vitals where client_reading_id = ?", [item.clientReadingId]);
      synced += 1;
      continue;
    }
    if (result.error === NETWORK_ERROR_MESSAGE) {
      recordSyncError("offline_vitals", "flush:network", result.error);
      return { synced, remaining: pending.length - synced, stoppedOffline: true };
    }
    recordSyncError("offline_vitals", `flush:${item.clientReadingId}`, result.error ?? "unknown error");
    await db.runAsync(
      "update pending_vitals set attempts = attempts + 1, last_error = ? where client_reading_id = ?",
      [result.error ?? "unknown error", item.clientReadingId]
    );
  }

  return { synced, remaining: pending.length - synced, stoppedOffline: false };
}
