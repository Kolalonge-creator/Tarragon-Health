import * as SQLite from "expo-sqlite";
import { supabase } from "./supabase";
import { recordSyncError } from "./sync-diagnostics";
import { loadOfflineSyncConfig } from "./offline-sync-config";
import { OFFLINE_BUDGET } from "./offline-budget";
import { classifyFailure, pullFloor, type OfflineSyncConfig } from "./outbox-rules";

/**
 * Read mirror of the patient's own records on the phone (S06), so logging
 * screens have something to show with no signal. The outbox (outbox.ts) is
 * where writes go; this is where reads come from when the network is down.
 *
 * Pull rule (founder decision S06-4): per table, read rows whose created_at is
 * at or after the stored cursor minus an overlap, ordered by created_at then
 * id, in pages, and upsert by id. The overlap catches a row that committed late
 * (created_at is server insert time and commit order can differ); upserting by
 * id makes a re-read harmless. Live tables, not the S05 aliasing views.
 *
 * Patient-authored vitals, symptoms and doses are append-only, so a mirror row
 * never changes after it is first seen. Medications and the patient's tasks are
 * small and change in place, so each is replaced whole (and a failed pull never
 * empties them: the last good copy stays until a newer one arrives).
 */

export type MirrorKind = "vital" | "symptom" | "dose";

const TABLE_FOR_KIND = {
  vital: "vitals_readings",
  symptom: "symptoms",
  dose: "medication_logs",
} as const;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("tarragon-offline.db").then(async (db) => {
      await db.execAsync(
        `create table if not exists local_records (
          kind text not null,
          id text not null,
          owner_user_id text not null,
          subject_id text not null,
          created_at text not null,
          row text not null,
          primary key (kind, id)
        );
        create index if not exists local_records_read on local_records (kind, owner_user_id, subject_id, created_at);
        create table if not exists local_medications (
          id text primary key,
          owner_user_id text not null,
          subject_id text not null,
          row text not null
        );
        create table if not exists local_tasks (
          id text primary key,
          owner_user_id text not null,
          subject_id text not null,
          row text not null
        );
        create table if not exists sync_state (key text primary key, value text not null);`
      );
      return db;
    });
  }
  return dbPromise;
}

async function currentUserId(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

type RemoteRow = { id: string; created_at: string; [key: string]: unknown };

export interface PullResult {
  pulled: number;
  stoppedOffline: boolean;
  /** Pages read this run, across all tables. */
  pages: number;
  /** Approximate bytes received (JSON length), for the data-use budget. */
  bytes: number;
}

async function readCursor(db: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>("select value from sync_state where key = ?", [key]);
  return row?.value ?? null;
}

async function writeCursor(db: SQLite.SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync("insert or replace into sync_state (key, value) values (?, ?)", [key, value]);
}

async function pullKind(
  db: SQLite.SQLiteDatabase,
  kind: MirrorKind,
  owner: string,
  subjectId: string,
  config: OfflineSyncConfig,
  budget: { pagesLeft: number },
  result: PullResult
): Promise<void> {
  const cursorKey = `pull:${owner}:${subjectId}:${kind}`;
  const stored = await readCursor(db, cursorKey);
  const initialFloor = new Date(Date.now() - OFFLINE_BUDGET.initialPullDays * 86_400_000).toISOString();
  const floor = pullFloor(stored, config) ?? initialFloor;
  let lastCreated: string | null = null;
  let lastId: string | null = null;

  while (budget.pagesLeft > 0) {
    let query = supabase
      .from(TABLE_FOR_KIND[kind])
      .select("*")
      .eq("patient_id", subjectId)
      .gte("created_at", floor)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(OFFLINE_BUDGET.pullPageSize);
    if (lastCreated && lastId) {
      query = query.or(`created_at.gt.${lastCreated},and(created_at.eq.${lastCreated},id.gt.${lastId})`);
    }
    const { data, error } = await query;
    budget.pagesLeft -= 1;
    result.pages += 1;
    if (error) {
      if (classifyFailure({ code: error.code, message: error.message }) === "network") result.stoppedOffline = true;
      recordSyncError("offline_outbox", `pull:${kind}`, error.message);
      return;
    }
    const rows = (data ?? []) as unknown as RemoteRow[];
    result.bytes += JSON.stringify(rows).length;
    for (const row of rows) {
      await db.runAsync(
        "insert or replace into local_records (kind, id, owner_user_id, subject_id, created_at, row) values (?, ?, ?, ?, ?, ?)",
        [kind, row.id, owner, subjectId, row.created_at, JSON.stringify(row)]
      );
    }
    result.pulled += rows.length;
    if (rows.length > 0) {
      const last = rows[rows.length - 1];
      lastCreated = last.created_at;
      lastId = last.id;
      // Never move the cursor past rows that were not yet stored.
      await writeCursor(db, cursorKey, last.created_at);
    }
    if (rows.length < OFFLINE_BUDGET.pullPageSize) return;
  }
}

/** Active medications are small and clinician-owned: replace the whole list. */
async function pullMedications(db: SQLite.SQLiteDatabase, owner: string, subjectId: string, result: PullResult) {
  const { data, error } = await supabase
    .from("medications")
    .select("id, drug_name, dose, frequency, schedule_times, source, is_active, superseded_at")
    .eq("patient_id", subjectId)
    .eq("is_active", true);
  result.pages += 1;
  if (error) {
    if (classifyFailure({ code: error.code, message: error.message }) === "network") result.stoppedOffline = true;
    recordSyncError("offline_outbox", "pull:medications", error.message);
    return;
  }
  const rows = (data ?? []) as unknown as { id: string }[];
  result.bytes += JSON.stringify(rows).length;
  await db.execAsync("begin");
  try {
    await db.runAsync("delete from local_medications where owner_user_id = ? and subject_id = ?", [owner, subjectId]);
    for (const row of rows) {
      await db.runAsync("insert or replace into local_medications (id, owner_user_id, subject_id, row) values (?, ?, ?, ?)", [
        row.id,
        owner,
        subjectId,
        JSON.stringify(row),
      ]);
    }
    await db.execAsync("commit");
  } catch (e) {
    await db.execAsync("rollback");
    throw e;
  }
  result.pulled += rows.length;
}

/**
 * The patient's own tasks (the patient_tasks view: the caller's patient-owned care_tasks).
 * Tasks change status in place, so the cursor pull used for append-only rows does not fit:
 * replace the whole small set instead. Open tasks plus whatever changed recently, newest
 * change first, capped. On any error the mirror is left exactly as it was, so a missing
 * view (before the S07 migration is applied) or a dropped connection never wipes a good copy.
 */
async function pullTasks(db: SQLite.SQLiteDatabase, owner: string, subjectId: string, result: PullResult) {
  const { data, error } = await supabase
    .from("patient_tasks")
    .select("id, kind, title, priority, due_at, recurrence, owner_role, state, status, care_plan_id, source_event_id, updated_at")
    .eq("patient_id", subjectId)
    .order("updated_at", { ascending: false })
    .limit(OFFLINE_BUDGET.taskPullLimit);
  result.pages += 1;
  if (error) {
    if (classifyFailure({ code: error.code, message: error.message }) === "network") result.stoppedOffline = true;
    recordSyncError("offline_outbox", "pull:tasks", error.message);
    return;
  }
  const rows = (data ?? []) as unknown as { id: string }[];
  result.bytes += JSON.stringify(rows).length;
  await db.execAsync("begin");
  try {
    await db.runAsync("delete from local_tasks where owner_user_id = ? and subject_id = ?", [owner, subjectId]);
    for (const row of rows) {
      await db.runAsync("insert or replace into local_tasks (id, owner_user_id, subject_id, row) values (?, ?, ?, ?)", [
        row.id,
        owner,
        subjectId,
        JSON.stringify(row),
      ]);
    }
    await db.execAsync("commit");
  } catch (e) {
    await db.execAsync("rollback");
    throw e;
  }
  result.pulled += rows.length;
}

/** Pulls the patient's own changes into the mirror. Never throws. */
export async function pullChanges(subjectId: string): Promise<PullResult> {
  const result: PullResult = { pulled: 0, stoppedOffline: false, pages: 0, bytes: 0 };
  try {
    const owner = await currentUserId();
    if (!owner) return result;
    const db = await getDb();
    const config = await loadOfflineSyncConfig();
    for (const kind of ["vital", "symptom", "dose"] as const) {
      if (result.stoppedOffline) break;
      // Each table gets its own page budget so a big vitals backlog cannot starve the others.
      await pullKind(db, kind, owner, subjectId, config, { pagesLeft: OFFLINE_BUDGET.maxPagesPerPull }, result);
    }
    if (!result.stoppedOffline) await pullMedications(db, owner, subjectId, result);
    if (!result.stoppedOffline) await pullTasks(db, owner, subjectId, result);
    // Local housekeeping, safe offline. Never lets a purge failure fail the pull.
    await purgeMirror(owner).catch((error) => recordSyncError("offline_outbox", "purgeMirror", error));
  } catch (error) {
    recordSyncError("offline_outbox", "pull", error);
  }
  return result;
}

/**
 * Keeps the read mirror from growing without limit on a low-storage phone.
 * Deletes mirror rows older than mirrorRetentionDays, measured back from the
 * NEWEST mirrored row of the same kind and subject, not from the phone's clock:
 * server created_at is the only clock we trust, and a phone whose clock jumped
 * forward (a power cut can reset it) must never be able to wipe the mirror.
 * Touches local_records only. The outbox (unsent logs), drafts and the
 * medication list are never purged here.
 */
export async function purgeMirror(owner: string): Promise<number> {
  const db = await getDb();
  const groups = await db.getAllAsync<{ kind: string; subject_id: string; newest: string }>(
    "select kind, subject_id, max(created_at) as newest from local_records where owner_user_id = ? group by kind, subject_id",
    [owner]
  );
  let purged = 0;
  for (const group of groups) {
    const cutoff = new Date(new Date(group.newest).getTime() - OFFLINE_BUDGET.mirrorRetentionDays * 86_400_000).toISOString();
    const before = await db.getFirstAsync<{ n: number }>(
      "select count(*) as n from local_records where kind = ? and owner_user_id = ? and subject_id = ? and created_at < ?",
      [group.kind, owner, group.subject_id, cutoff]
    );
    if (!before?.n) continue;
    await db.runAsync(
      "delete from local_records where kind = ? and owner_user_id = ? and subject_id = ? and created_at < ?",
      [group.kind, owner, group.subject_id, cutoff]
    );
    purged += before.n;
  }
  return purged;
}

/** Newest first, scoped to the signed-in account and the subject. */
export async function readLocalRecords<T>(kind: MirrorKind, subjectId: string, limit = 50): Promise<T[]> {
  const owner = await currentUserId();
  if (!owner) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{ row: string }>(
    "select row from local_records where kind = ? and owner_user_id = ? and subject_id = ? order by created_at desc, id desc limit ?",
    [kind, owner, subjectId, limit]
  );
  return rows.map((r) => JSON.parse(r.row) as T);
}

export async function readLocalMedications<T>(subjectId: string): Promise<T[]> {
  const owner = await currentUserId();
  if (!owner) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{ row: string }>(
    "select row from local_medications where owner_user_id = ? and subject_id = ?",
    [owner, subjectId]
  );
  return rows.map((r) => JSON.parse(r.row) as T);
}

export async function readLocalTasks<T>(subjectId: string): Promise<T[]> {
  const owner = await currentUserId();
  if (!owner) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{ row: string }>(
    "select row from local_tasks where owner_user_id = ? and subject_id = ?",
    [owner, subjectId]
  );
  return rows.map((r) => JSON.parse(r.row) as T);
}

/**
 * Wipes the read mirror and cursors (not the outbox: unsent logs must survive
 * sign-out). Call on sign-out so a shared phone does not keep the previous
 * account's record readable.
 */
export async function clearLocalMirror(): Promise<void> {
  const db = await getDb();
  await db.execAsync("delete from local_records; delete from local_medications; delete from local_tasks; delete from sync_state;");
}

const lastPullAt = new Map<string, number>();
const PULL_MIN_INTERVAL_MS = 5 * 60_000;

/** Fire-and-forget pull for screens: at most one per subject every 5 minutes. */
export function pullChangesThrottled(subjectId: string, now: number = Date.now()): void {
  const last = lastPullAt.get(subjectId) ?? 0;
  if (now - last < PULL_MIN_INTERVAL_MS) return;
  lastPullAt.set(subjectId, now);
  void pullChanges(subjectId);
}

/** Test hook: forget throttle state. */
export function __resetPullThrottle(): void {
  lastPullAt.clear();
}
