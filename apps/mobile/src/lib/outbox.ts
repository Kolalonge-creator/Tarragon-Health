import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { NETWORK_ERROR_MESSAGE, postVitalReading, type VitalReadingPayload } from "./api";
import { supabase } from "./supabase";
import { recordSyncError } from "./sync-diagnostics";
import { loadOfflineSyncConfig } from "./offline-sync-config";
import {
  backoffMs,
  classifyFailure,
  isStuck,
  mayFlushUnder,
  supportCode,
  type FailureInfo,
  type OutboxKind,
  type OutboxState,
} from "./outbox-rules";

/**
 * The one offline outbox (S06): vitals, symptoms and dose logs. A log is
 * durable here before any network call. See docs/design/S06.md for the rules
 * this file implements: idempotency by client id, oldest first, one rejected
 * row never blocks the queue, a row is never flushed under a different
 * account than the one that logged it, and nothing is ever dropped silently.
 *
 * Nothing here changes a treatment plan (INV-02): only readings, symptoms and
 * dose logs queue. Medication changes are online only.
 */

export interface SymptomPayload {
  symptom_type: string;
  severity: number;
  description: string | null;
}

export interface DosePayload {
  medication_id: string;
  scheduled_time: string | null;
  scheduled_for_date: string;
  status: string;
  organisation_id: string;
}

export type OutboxPayload = VitalReadingPayload | SymptomPayload | DosePayload;

interface OutboxRow {
  client_id: string;
  kind: OutboxKind;
  owner_user_id: string;
  subject_id: string;
  beneficiary_profile_id: string | null;
  payload: string;
  client_recorded_at: string;
  created_at: string;
  attempts: number;
  next_attempt_at: string;
  state: OutboxState;
  last_error: string | null;
  last_status: number | null;
  danger: number;
  group_id: string | null;
}

export interface OutboxItem {
  clientId: string;
  /** Rows saved together (one blood pressure log with its pulse and symptoms) share a group id. */
  groupId?: string;
  kind: OutboxKind;
  ownerUserId: string;
  subjectId: string;
  beneficiaryProfileId?: string;
  payload: OutboxPayload;
  clientRecordedAt: string;
  createdAt: string;
  attempts: number;
  state: OutboxState;
  lastError: string | null;
  danger: boolean;
  supportCode: string;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Test hook: forget the opened database so the next call re-runs setup and the legacy migration. */
export function __resetOutboxForTests(): void {
  dbPromise = null;
  groupColumnReady = true;
}

/**
 * False only if adding the group_id column failed on this phone. Single-row saves never
 * name the column, and a group save falls back to ungrouped rows (still all or none),
 * so a failed upgrade can never stop a patient logging.
 */
let groupColumnReady = true;

/** Test hook. */
export function __setGroupColumnReadyForTests(ready: boolean): void {
  groupColumnReady = ready;
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("tarragon-offline.db").then(async (db) => {
      await db.execAsync(
        `create table if not exists outbox (
          client_id text primary key,
          kind text not null,
          owner_user_id text not null,
          subject_id text not null,
          beneficiary_profile_id text,
          payload text not null,
          client_recorded_at text not null,
          created_at text not null,
          attempts integer not null default 0,
          next_attempt_at text not null,
          state text not null default 'pending',
          last_error text,
          last_status integer,
          danger integer not null default 0
        );
        create index if not exists outbox_state_created on outbox (state, created_at);
        create table if not exists pending_vitals (
          client_reading_id text primary key,
          payload text not null,
          beneficiary_profile_id text,
          created_at text not null,
          attempts integer not null default 0,
          last_error text
        );`
      );
      // Added after the first release of the outbox: a phone that already has the table gets the column.
      try {
        const columns = await db.getAllAsync<{ name: string }>("pragma table_info(outbox)");
        if (!columns.some((c) => c.name === "group_id")) {
          await db.execAsync("alter table outbox add column group_id text");
        }
      } catch (error) {
        groupColumnReady = false;
        recordSyncError("offline_outbox", "addGroupColumn", error);
      }
      try {
        await migrateLegacyVitals(db);
      } catch (error) {
        // Adopting old rows is best effort and retried next open; it must never
        // take the whole outbox down with it.
        recordSyncError("offline_outbox", "migrateLegacyVitals", error);
      }
      return db;
    }).catch((error) => {
      // Do not memoise a failed open: the next call tries again.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/**
 * Rows queued by the pre-S06 vitals queue belong to whoever is signed in when
 * the new version first opens. The old table did not record an owner; the
 * device has had one signed-in account in practice, so adopting the current
 * session is the safe reading. With no session the rows are left in place and
 * adopted on the next open.
 */
async function migrateLegacyVitals(db: SQLite.SQLiteDatabase): Promise<void> {
  const legacy = await db.getAllAsync<{
    client_reading_id: string;
    payload: string;
    beneficiary_profile_id: string | null;
    created_at: string;
    attempts: number;
    last_error: string | null;
  }>("select * from pending_vitals");
  if (legacy.length === 0) return;
  const userId = await currentUserId();
  if (!userId) return;
  for (const row of legacy) {
    await db.runAsync(
      `insert or ignore into outbox
        (client_id, kind, owner_user_id, subject_id, beneficiary_profile_id, payload, client_recorded_at,
         created_at, attempts, next_attempt_at, state, last_error, danger)
       values (?, 'vital', ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0)`,
      [
        row.client_reading_id,
        userId,
        row.beneficiary_profile_id ?? userId,
        row.beneficiary_profile_id,
        row.payload,
        row.created_at,
        row.created_at,
        row.attempts,
        row.created_at,
        row.last_error,
      ]
    );
    await db.runAsync("delete from pending_vitals where client_reading_id = ?", [row.client_reading_id]);
  }
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

function toItem(row: OutboxRow): OutboxItem {
  return {
    clientId: row.client_id,
    groupId: row.group_id ?? undefined,
    kind: row.kind,
    ownerUserId: row.owner_user_id,
    subjectId: row.subject_id,
    beneficiaryProfileId: row.beneficiary_profile_id ?? undefined,
    payload: JSON.parse(row.payload) as OutboxPayload,
    clientRecordedAt: row.client_recorded_at,
    createdAt: row.created_at,
    attempts: row.attempts,
    state: row.state,
    lastError: row.last_error,
    danger: row.danger === 1,
    supportCode: supportCode(row.client_id),
  };
}

export interface EnqueueInput {
  kind: OutboxKind;
  /** Whose record this is: the patient, or the supported person's profile. */
  subjectId: string;
  beneficiaryProfileId?: string;
  payload: OutboxPayload;
  /** True when the device itself classed the reading urgent or emergency. */
  danger?: boolean;
}

export class NotSignedInError extends Error {
  constructor() {
    super("Sign in to log this.");
    this.name = "NotSignedInError";
  }
}

function buildRow(owner: string, input: EnqueueInput, now: string, groupId: string | null): OutboxRow {
  return {
    client_id: Crypto.randomUUID(),
    kind: input.kind,
    owner_user_id: owner,
    subject_id: input.subjectId,
    beneficiary_profile_id: input.beneficiaryProfileId ?? null,
    payload: JSON.stringify(input.payload),
    client_recorded_at: now,
    created_at: now,
    attempts: 0,
    next_attempt_at: now,
    state: "pending",
    last_error: null,
    last_status: null,
    danger: input.danger ? 1 : 0,
    group_id: groupId,
  };
}

// The single-row insert does not name group_id, so it works on a phone that has no such column.
const INSERT_ROW_SQL = `insert into outbox
  (client_id, kind, owner_user_id, subject_id, beneficiary_profile_id, payload, client_recorded_at,
   created_at, attempts, next_attempt_at, state, last_error, danger)
 values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', null, ?)`;

const INSERT_GROUPED_ROW_SQL = `insert into outbox
  (client_id, kind, owner_user_id, subject_id, beneficiary_profile_id, payload, client_recorded_at,
   created_at, attempts, next_attempt_at, state, last_error, danger, group_id)
 values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', null, ?, ?)`;

function insertParams(r: OutboxRow, grouped: boolean): (string | number | null)[] {
  const base = [
    r.client_id, r.kind, r.owner_user_id, r.subject_id, r.beneficiary_profile_id, r.payload,
    r.client_recorded_at, r.created_at, r.next_attempt_at, r.danger,
  ];
  return grouped ? [...base, r.group_id] : base;
}

/** Instant, zero-network write. Durable the moment it resolves. */
export async function enqueue(input: EnqueueInput): Promise<OutboxItem> {
  const owner = await currentUserId();
  if (!owner) throw new NotSignedInError();
  const db = await getDb();
  const row = buildRow(owner, input, new Date().toISOString(), null);
  await db.runAsync(INSERT_ROW_SQL, insertParams(row, false));
  return toItem(row);
}

/**
 * Saves several rows as one unit: all of them are on the phone, or none are.
 * Used when one action produces more than one record (a blood pressure reading
 * with its pulse and the symptoms ticked beside it), so a crash or a full disk
 * can never leave the reading saved and its symptoms lost.
 *
 * Rows are written in the order given and sync oldest first, so put the rows
 * that must reach the care team first (a red-flag symptom before the reading).
 * They share a group id and a timestamp. The sync sends one row at a time, and
 * a row the server errors on is retried later without holding the others back,
 * so the order is "first when the network and server allow", not a guarantee.
 * What is guaranteed is that no row is dropped silently: a row that has not
 * gone stays listed (and, if it was marked danger, raises the one-hour "not yet
 * reached your care team" notice on its own).
 */
export async function enqueueGroup(inputs: readonly EnqueueInput[]): Promise<OutboxItem[]> {
  if (inputs.length === 0) return [];
  const owner = await currentUserId();
  if (!owner) throw new NotSignedInError();
  const db = await getDb();
  const grouped = groupColumnReady;
  const groupId = Crypto.randomUUID();
  const now = new Date().toISOString();
  const rows = inputs.map((input) => buildRow(owner, input, now, grouped ? groupId : null));
  const sql = grouped ? INSERT_GROUPED_ROW_SQL : INSERT_ROW_SQL;
  try {
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const row of rows) await txn.runAsync(sql, insertParams(row, grouped));
    });
  } catch (error) {
    // The exclusive transaction opens a second connection and can fail while another statement
    // holds the write lock (a flush deleting a sent row). Retry once on the main connection:
    // all or none still holds, and a flush statement that interleaves is harmless because sends
    // are idempotent. A real failure (a duplicate id, a full disk) fails again and is thrown.
    recordSyncError("offline_outbox", "enqueueGroup:exclusiveTransaction", error);
    await db.withTransactionAsync(async () => {
      for (const row of rows) await db.runAsync(sql, insertParams(row, grouped));
    });
  }
  return rows.map(toItem);
}

/** Every row on the phone for every account, oldest first. Internal: the sync worker needs all owners to count held rows. */
async function listAllOutbox(kind?: OutboxKind): Promise<OutboxItem[]> {
  const db = await getDb();
  const rows = kind
    ? await db.getAllAsync<OutboxRow>("select * from outbox where kind = ? order by created_at asc, rowid asc", [kind])
    : await db.getAllAsync<OutboxRow>("select * from outbox order by created_at asc, rowid asc");
  return rows.map(toItem);
}

/**
 * Rows not yet on the server (waiting or rejected) that belong to the account
 * signed in now, oldest first. Another account's rows are never listed, shown
 * or counted here (they are only counted as "held").
 */
export async function listOutbox(kind?: OutboxKind): Promise<OutboxItem[]> {
  const [items, userId] = await Promise.all([listAllOutbox(kind), currentUserId()]);
  return items.filter((item) => mayFlushUnder(item.ownerUserId, userId));
}

export async function getPendingCount(): Promise<number> {
  return (await listOutbox()).length;
}

export interface OutboxSummary {
  waiting: number;
  rejected: number;
  /** Waiting rows past their notice time, plus every rejected row. */
  stuck: number;
  /** Rows logged under an account that is not signed in right now. */
  heldForOtherAccount: number;
  oldestWaitingAt: string | null;
}

export async function getOutboxSummary(now: Date = new Date()): Promise<OutboxSummary> {
  const [items, config, userId] = await Promise.all([listAllOutbox(), loadOfflineSyncConfig(), currentUserId()]);
  const summary: OutboxSummary = { waiting: 0, rejected: 0, stuck: 0, heldForOtherAccount: 0, oldestWaitingAt: null };
  for (const item of items) {
    if (!mayFlushUnder(item.ownerUserId, userId)) {
      summary.heldForOtherAccount += 1;
      continue;
    }
    if (item.state === "rejected") summary.rejected += 1;
    else {
      summary.waiting += 1;
      summary.oldestWaitingAt ??= item.createdAt;
    }
    if (isStuck({ created_at: item.createdAt, danger: item.danger ? 1 : 0, state: item.state }, now, config)) {
      summary.stuck += 1;
    }
  }
  return summary;
}

/** Patient pressed Retry on a rejected row: back to waiting, due now. */
export async function retryRow(clientId: string): Promise<void> {
  const [db, userId] = await Promise.all([getDb(), currentUserId()]);
  if (!userId) return;
  await db.runAsync(
    "update outbox set state = 'pending', attempts = 0, next_attempt_at = ?, last_error = null where client_id = ? and owner_user_id = ?",
    [new Date().toISOString(), clientId, userId]
  );
}

/**
 * The only way a row leaves the phone without reaching the server: an explicit,
 * confirmed patient action on a REJECTED row. Never called by the sync worker.
 */
export async function discardRejectedRow(clientId: string): Promise<boolean> {
  const [db, userId] = await Promise.all([getDb(), currentUserId()]);
  if (!userId) return false;
  const row = await db.getFirstAsync<{ state: OutboxState }>(
    "select state from outbox where client_id = ? and owner_user_id = ?",
    [clientId, userId]
  );
  if (!row || row.state !== "rejected") return false;
  await db.runAsync("delete from outbox where client_id = ? and state = 'rejected' and owner_user_id = ?", [clientId, userId]);
  recordSyncError("offline_outbox", `discard:${supportCode(clientId)}`, "removed by the patient after rejection");
  return true;
}

export interface FlushResult {
  synced: number;
  /** Rows still on the phone (waiting or rejected). */
  remaining: number;
  /** true when the run stopped because the network or the session was down. */
  stoppedOffline: boolean;
  /** Rows left alone because they were logged under a different account. */
  held: number;
  /** Rows marked rejected during this run. */
  newlyRejected: number;
}

type SendOutcome = { ok: true } | ({ ok: false } & FailureInfo);

function asFailure(error: unknown): SendOutcome {
  if (error && typeof error === "object") {
    const e = error as { code?: string; message?: string; status?: number };
    return { ok: false, code: e.code, message: e.message, status: e.status };
  }
  return { ok: false, message: error instanceof Error ? error.message : String(error) };
}

async function send(item: OutboxItem): Promise<SendOutcome> {
  try {
    if (item.kind === "vital") {
      const result = await postVitalReading(
        item.payload as VitalReadingPayload,
        item.beneficiaryProfileId,
        item.clientId,
        item.clientRecordedAt
      );
      if (result.success) return { ok: true };
      return { ok: false, message: result.error, status: result.status };
    }

    if (item.kind === "symptom") {
      const p = item.payload as SymptomPayload;
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", item.subjectId)
        .single();
      if (profileError) return asFailure(profileError);
      if (!profile?.organisation_id) return { ok: false, status: 400, message: "No organisation on file" };
      const { error } = await supabase.from("symptoms").insert({
        organisation_id: profile.organisation_id,
        patient_id: item.subjectId,
        symptom_type: p.symptom_type as never,
        severity: p.severity,
        description: p.description,
        client_id: item.clientId,
        client_recorded_at: item.clientRecordedAt,
      });
      return error ? asFailure(error) : { ok: true };
    }

    const p = item.payload as DosePayload;
    const { error } = await supabase.from("medication_logs").insert({
      medication_id: p.medication_id,
      scheduled_time: p.scheduled_time,
      scheduled_for_date: p.scheduled_for_date,
      status: p.status as never,
      patient_id: item.subjectId,
      organisation_id: p.organisation_id,
      client_id: item.clientId,
      client_recorded_at: item.clientRecordedAt,
    });
    return error ? asFailure(error) : { ok: true };
  } catch (error) {
    // fetch threw before any response: an outage, not a refusal.
    return { ok: false, message: error instanceof Error ? error.message : NETWORK_ERROR_MESSAGE };
  }
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Drains the outbox oldest-first. Concurrent callers (a screen, the background
 * task) share one run so the same row is never in flight twice.
 */
export function flushOutbox(): Promise<FlushResult> {
  if (!flushing) {
    flushing = runFlush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function runFlush(): Promise<FlushResult> {
  const db = await getDb();
  const userId = await currentUserId();
  const now = new Date();
  const items = await listAllOutbox();
  const result: FlushResult = { synced: 0, remaining: items.length, stoppedOffline: false, held: 0, newlyRejected: 0 };

  for (const item of items) {
    if (!mayFlushUnder(item.ownerUserId, userId)) {
      result.held += 1;
      continue;
    }
    if (item.state === "rejected") continue;
    const due = await db.getFirstAsync<{ next_attempt_at: string }>(
      "select next_attempt_at from outbox where client_id = ?",
      [item.clientId]
    );
    if (due && new Date(due.next_attempt_at).getTime() > now.getTime()) continue;

    const outcome = await send(item);
    if (outcome.ok) {
      await db.runAsync("delete from outbox where client_id = ?", [item.clientId]);
      result.synced += 1;
      result.remaining -= 1;
      continue;
    }

    const cls = classifyFailure(outcome);
    const detail = `flush:${supportCode(item.clientId)}`;
    const message = outcome.message ?? "unknown error";
    if (cls === "duplicate") {
      await db.runAsync("delete from outbox where client_id = ?", [item.clientId]);
      result.synced += 1;
      result.remaining -= 1;
    } else if (cls === "network" || cls === "auth") {
      recordSyncError("offline_outbox", `${detail}:${cls}`, message);
      result.stoppedOffline = true;
      return result;
    } else if (cls === "rejected") {
      recordSyncError("offline_outbox", `${detail}:rejected`, message);
      await db.runAsync(
        "update outbox set state = 'rejected', attempts = attempts + 1, last_error = ?, last_status = ? where client_id = ?",
        [message, outcome.status ?? null, item.clientId]
      );
      result.newlyRejected += 1;
    } else {
      recordSyncError("offline_outbox", `${detail}:retry`, message);
      const wait = backoffMs(item.attempts + 1);
      await db.runAsync(
        "update outbox set attempts = attempts + 1, last_error = ?, last_status = ?, next_attempt_at = ? where client_id = ?",
        [message, outcome.status ?? null, new Date(now.getTime() + wait).toISOString(), item.clientId]
      );
    }
  }
  return result;
}
