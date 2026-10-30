import type * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { NETWORK_ERROR_MESSAGE, postMealLog, postVitalReading, type VitalReadingPayload } from "./api";
import { supabase } from "./supabase";
import type { BirthPlanPayload, ContractionSessionPayload, KickSessionPayload } from "./pregnancy-payloads";
import { getStoreWithSchema } from "./secure-db";
import { applyReportOutcome, reportOnHold, reportRejection } from "./rejection-report";
import { addDataUsage } from "./data-usage";
import { getConnectionKind } from "./connection-kind";
import { isHeldForWifi, loadHoldContext } from "./wifi-hold";
import type { ConnectionKind } from "./data-cost-rules";
import { pullAnchorsFor } from "./offline-store";
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
  /** Why a dose was skipped or could not be taken (a short key, never free text from the patient's medical history). */
  reason?: string | null;
}

/**
 * S13 R4 (CMO Q13): what the patient said about seeking care after a red alert. Sent with the database function
 * record_red_care_response, which is idempotent by the outbox client id. It is information for the on-call clinician and
 * never stops paging. The phone does not know the server's event id, so the server links it to the latest red alert of the day.
 */
export interface RedCarePayload {
  response: "sought_care" | "could_not_get_care";
}

/** S08z: anchor times the patient set (anchor id to "HH:MM") and the first Lagos date they apply from. */
export interface AnchorTimesPayload {
  times: Record<string, string>;
  effective_from: string;
}

/** S08z: a "my day has shifted" entry: the dates and how many minutes to move each named anchor. Sent with the row's client id, so a retry makes one shift. */
export interface DayShiftPayload {
  starts_on: string;
  ends_on: string;
  offsets: Record<string, number>;
}

/** S08z: ending a shift the server already holds, from `cancelled_from` onward. */
export interface DayShiftEndPayload {
  shift_id: string;
  cancelled_from: string;
}

/**
 * S49a: a meal written in words (logged, repeated in one tap, or picked from a favourite). Only the words travel: the server recomputes the
 * nutrition from its food table, so a phone can never write its own calories. Idempotent by the outbox client id, so a retry after a lost
 * reply is a duplicate, not a second meal. A meal photo is NOT queued here (the photo upload needs a connection; see lifestyle-trackers).
 */
export interface MealPayload {
  meal_type: "breakfast" | "lunch" | "dinner" | "snack";
  description: string;
}

/**
 * S48b: a workout the person did, saved on the phone first. The kind is one of the seven activity kinds (the database enum); the name is derived
 * by the database from the kind. Idempotent by the outbox client id (activity_log_entries.client_id), so a retry is a duplicate, not a second workout.
 * Logging something that already happened is never blocked by the activity safety gate.
 */
export interface ActivityPayload {
  activity_kind: "walking" | "running" | "cycling" | "dancing" | "football" | "farm_manual_work" | "chair_based";
  duration_minutes: number;
  /** Whole metres, or null. */
  distance_m: number | null;
  /** The Lagos calendar day it happened. */
  logged_on: string;
}

/**
 * P4: an exercise session saved on the phone first. Idempotent by the outbox client id (exercise_session_logs.client_id), so a resend after a lost
 * reply is a duplicate, not a second session. The database triggers still decide the date window and raise the Member symptom alert when it lands.
 */
export interface ExerciseSessionPayload {
  /** The Lagos calendar day it happened. */
  performed_on: string;
  duration_minutes: number;
  kind: "walking" | "mobility" | "strength" | "cardio" | "other";
  effort: "easy" | "moderate" | "hard" | null;
  symptom_during: boolean;
  enrollment_id: string | null;
  note: string | null;
}

/**
 * D.1: a wellbeing check-in saved on the phone first. The table has no client id column, so the check-in time (the outbox row's recorded
 * time) is the idempotency key: a retry after a lost reply finds the row it already wrote and sends nothing. Scores are the same 1 to 5
 * the database CHECKs; tags are the fixed list. This is the check-in only. The mental health screening questionnaires stay online, because
 * they trigger follow-up and a crisis route that must not wait in a queue unseen.
 */
export interface WellbeingCheckinPayload {
  organisation_id: string;
  mood_score: number;
  stress_score: number;
  sleep_quality: number;
  activity_level: number;
  note: string | null;
  tags: string[];
}

export type OutboxPayload =
  | WellbeingCheckinPayload
  | AnchorTimesPayload
  | DayShiftPayload
  | DayShiftEndPayload
  | ActivityPayload
  | ExerciseSessionPayload
  | VitalReadingPayload
  | MealPayload
  | SymptomPayload
  | DosePayload
  | RedCarePayload
  | KickSessionPayload
  | ContractionSessionPayload
  | BirthPlanPayload;

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

/** Test hook: forget the opened database so the next call re-runs setup and the legacy migration. */
export function __resetOutboxForTests(): void {
  setupGeneration += 1;
  groupColumnReady = true;
  reportedColumnReady = true;
}

/**
 * False only if adding the group_id column failed on this phone. Single-row saves never
 * name the column, and a group save falls back to ungrouped rows (still all or none),
 * so a failed upgrade can never stop a patient logging.
 */
let groupColumnReady = true;
/** Same idea for the S06x rejection_reported column: without it a rejection is reported again on every retry (the server ignores the repeat). */
let reportedColumnReady = true;

/** Test hook. */
export function __setGroupColumnReadyForTests(ready: boolean): void {
  groupColumnReady = ready;
}

/** Bumped by tests so the schema setup is keyed fresh and re-runs against the shared store. */
let setupGeneration = 0;

async function setupOutbox(db: SQLite.SQLiteDatabase): Promise<void> {
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
    const columns = await db.getAllAsync<{ name: string }>("pragma table_info(outbox)");
    if (!columns.some((c) => c.name === "rejection_reported")) {
      await db.execAsync("alter table outbox add column rejection_reported integer not null default 0");
    }
  } catch (error) {
    reportedColumnReady = false;
    recordSyncError("offline_outbox", "addRejectionReportedColumn", error);
  }
  try {
    await migrateLegacyVitals(db);
  } catch (error) {
    // Adopting old rows is best effort and retried next open; it must never
    // take the whole outbox down with it.
    recordSyncError("offline_outbox", "migrateLegacyVitals", error);
  }
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  return getStoreWithSchema(`outbox:${setupGeneration}`, setupOutbox);
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
  /**
   * When it really happened, ISO. Defaults to now. A dose taken earlier ("I took it
   * at 8") passes the time the patient chose; the server keeps it only inside its
   * bounded window and otherwise uses its own time (S06).
   */
  recordedAt?: string;
  /** Do not send before this many seconds have passed (the dose undo window). The row is still durable on the phone. */
  holdSeconds?: number;
}

export class NotSignedInError extends Error {
  constructor() {
    super("Sign in to log this.");
    this.name = "NotSignedInError";
  }
}

function buildRow(owner: string, input: EnqueueInput, now: string, groupId: string | null): OutboxRow {
  const recordedAt = input.recordedAt ?? now;
  const nextAttemptAt = input.holdSeconds ? new Date(Date.now() + input.holdSeconds * 1000).toISOString() : now;
  return {
    client_id: Crypto.randomUUID(),
    kind: input.kind,
    owner_user_id: owner,
    subject_id: input.subjectId,
    beneficiary_profile_id: input.beneficiaryProfileId ?? null,
    payload: JSON.stringify(input.payload),
    client_recorded_at: recordedAt,
    created_at: now,
    attempts: 0,
    next_attempt_at: nextAttemptAt,
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

/** Every unsent or rejected row on the phone, for every account. Used by the remote wipe to report a COUNT (never content). */
export async function countAllOutboxRows(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("select count(*) as n from outbox");
  return row?.n ?? 0;
}

export interface UnsentByOwner {
  owner: string;
  total: number;
  /** Rows the phone itself classed urgent or emergency. */
  danger: number;
}

/** Unsent counts per account for EVERY account on the phone (counts only). Used by the remote wipe so no account's loss is silent. */
export async function countUnsentByOwner(): Promise<UnsentByOwner[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ owner_user_id: string; n: number; d: number }>(
    "select owner_user_id, count(*) as n, coalesce(sum(danger), 0) as d from outbox group by owner_user_id"
  );
  return rows.map((r) => ({ owner: r.owner_user_id, total: r.n, danger: r.d }));
}

/** Urgent rows not yet on the server, for every account on the phone. */
export async function countDangerUnsent(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>("select count(*) as n from outbox where danger = 1");
  return row?.n ?? 0;
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
/**
 * Take back a row that has not left the phone (the dose undo window). Returns
 * false when the row is gone, already sent, or belongs to another account, so
 * the caller can say "too late" instead of pretending it was undone.
 */
export async function removePendingRow(clientId: string): Promise<boolean> {
  const [db, userId] = await Promise.all([getDb(), currentUserId()]);
  if (!userId) return false;
  const row = await db.getFirstAsync<{ state: OutboxState }>(
    "select state from outbox where client_id = ? and owner_user_id = ?",
    [clientId, userId]
  );
  if (!row || row.state !== "pending") return false;
  await db.runAsync("delete from outbox where client_id = ? and state = 'pending' and owner_user_id = ?", [clientId, userId]);
  return true;
}

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
  /** Ordinary entries left on the phone this run because the patient chose Wi-Fi only and the phone is on mobile data (S06z). Never an urgent entry. */
  heldForWifi: number;
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

    if (item.kind === "meal") {
      const result = await postMealLog(item.payload as MealPayload, item.clientId, item.clientRecordedAt);
      if (result.success) return { ok: true };
      return { ok: false, message: result.error, status: result.status };
    }

    if (item.kind === "activity") {
      const p = item.payload as ActivityPayload;
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", item.subjectId)
        .single();
      if (profileError) return asFailure(profileError);
      if (!profile?.organisation_id) return { ok: false, status: 400, message: "No organisation on file" };
      const { error } = await supabase.from("activity_log_entries").insert({
        organisation_id: profile.organisation_id,
        patient_id: item.subjectId,
        entry_type: "workout",
        activity_kind: p.activity_kind,
        duration_minutes: p.duration_minutes,
        distance_m: p.distance_m,
        logged_on: p.logged_on,
        client_id: item.clientId,
      });
      return error ? asFailure(error) : { ok: true };
    }

    if (item.kind === "exercise_session") {
      const p = item.payload as ExerciseSessionPayload;
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", item.subjectId)
        .single();
      if (profileError) return asFailure(profileError);
      if (!profile?.organisation_id) return { ok: false, status: 400, message: "No organisation on file" };
      const { error } = await supabase.from("exercise_session_logs").insert({
        organisation_id: profile.organisation_id,
        patient_id: item.subjectId,
        enrollment_id: p.enrollment_id,
        performed_on: p.performed_on,
        duration_minutes: p.duration_minutes,
        kind: p.kind,
        effort: p.effort,
        symptom_during: p.symptom_during,
        note: p.note,
        client_id: item.clientId,
      });
      return error ? asFailure(error) : { ok: true };
    }

    if (item.kind === "wellbeing_checkin") {
      const p = item.payload as WellbeingCheckinPayload;
      // Already sent (a lost reply last time)? Then this is a duplicate, not a second check-in.
      const existing = await supabase
        .from("wellbeing_checkins")
        .select("id")
        .eq("patient_id", item.subjectId)
        .eq("checked_in_at", item.clientRecordedAt)
        .limit(1);
      if (existing.error) return asFailure(existing.error);
      if (existing.data && existing.data.length > 0) return { ok: true };
      const { error } = await supabase.from("wellbeing_checkins").insert({
        organisation_id: p.organisation_id,
        patient_id: item.subjectId,
        mood_score: p.mood_score,
        stress_score: p.stress_score,
        sleep_quality: p.sleep_quality,
        activity_level: p.activity_level,
        note: p.note,
        tags: p.tags,
        checked_in_at: item.clientRecordedAt,
      });
      return error ? asFailure(error) : { ok: true };
    }

    if (item.kind === "red_care") {
      const p = item.payload as RedCarePayload;
      // A caregiver with the person's account open answers FOR the person: the database allows it only for a live manage grant that names
      // receive_alerts or log_readings and stores the row as the person's with the helper's id on it. The person's own answer is unchanged.
      const forSomeoneElse = item.subjectId !== item.ownerUserId;
      const { error } = forSomeoneElse
        ? await supabase.rpc("record_red_care_response_for" as never, {
            p_patient: item.subjectId,
            p_client_id: item.clientId,
            p_response: p.response,
            p_client_recorded_at: item.clientRecordedAt,
          } as never)
        : await supabase.rpc("record_red_care_response" as never, {
            p_client_id: item.clientId,
            p_response: p.response,
            p_client_recorded_at: item.clientRecordedAt,
          } as never);
      return error ? asFailure(error) : { ok: true };
    }

    if (item.kind === "birth_plan") {
      // S67: the plan is one row per pregnancy; a replay writes the same values, so it is idempotent (last saved wins, oldest first).
      return sendBirthPlan(item);
    }

    if (item.kind === "anchor_times") {
      const p = item.payload as AnchorTimesPayload;
      const { error } = await supabase.rpc("save_dose_anchor_times", {
        p_patient: item.subjectId,
        p_times: p.times,
        p_effective_from: p.effective_from,
      });
      return error ? asFailure(error) : { ok: true };
    }

    if (item.kind === "day_shift") {
      const p = item.payload as DayShiftPayload;
      const { error } = await supabase.rpc("create_day_shift", {
        p_patient: item.subjectId,
        p_client_id: item.clientId,
        p_starts_on: p.starts_on,
        p_ends_on: p.ends_on,
        p_offsets: p.offsets,
      });
      return error ? asFailure(error) : { ok: true };
    }

    if (item.kind === "day_shift_end") {
      const p = item.payload as DayShiftEndPayload;
      const { error } = await supabase.rpc("cancel_day_shift", { p_patient: item.subjectId, p_id: p.shift_id });
      return error ? asFailure(error) : { ok: true };
    }

    if (item.kind === "kick_session" || item.kind === "contraction_session") {
      // S67: a finished session is one idempotent row (unique per person and client id), so a replay after a lost reply is a duplicate, not a second card.
      return sendPregnancySession(item);
    }

    const p = item.payload as DosePayload;
    const { error } = await supabase.from("medication_logs").insert({
      medication_id: p.medication_id,
      scheduled_time: p.scheduled_time,
      scheduled_for_date: p.scheduled_for_date,
      status: p.status as never,
      reason: p.reason ?? null,
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

/**
 * The pregnancy tables are not in the generated client types yet (the types are spliced from the live project, which holds
 * other branches' schema, see CLAUDE.md), so the insert goes through this narrow shape instead of `any`.
 */
interface UntypedInsert {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { code?: string; message?: string } | null }>;
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: { code?: string; message?: string } | null }>;
  };
}

async function sendBirthPlan(item: OutboxItem): Promise<SendOutcome> {
  const client = supabase as unknown as UntypedInsert;
  const p = item.payload as BirthPlanPayload;
  const { error } = await client.from("birth_plans").upsert(
    { ...p.plan, organisation_id: p.organisation_id, patient_id: item.subjectId, pregnancy_id: p.pregnancy_id, source: "patient" },
    { onConflict: "pregnancy_id" },
  );
  return error ? asFailure(error) : { ok: true };
}

async function sendPregnancySession(item: OutboxItem): Promise<SendOutcome> {
  const client = supabase as unknown as UntypedInsert;
  if (item.kind === "kick_session") {
    const p = item.payload as KickSessionPayload;
    const { error } = await client.from("kick_counts").insert({
      organisation_id: p.organisation_id,
      patient_id: item.subjectId,
      client_id: item.clientId,
      started_at: p.started_at,
      ended_at: p.ended_at,
      movement_offsets_s: p.movement_offsets_s,
      reported_less: p.reported_less,
      result: p.result,
      result_reason: p.result_reason,
      minutes_to_target: p.minutes_to_target,
      week_at_start: p.week_at_start,
      config_version: p.config_version,
      source: "patient",
    });
    return error ? asFailure(error) : { ok: true };
  }
  const p = item.payload as ContractionSessionPayload;
  const { error } = await client.from("contractions").insert({
    organisation_id: p.organisation_id,
    patient_id: item.subjectId,
    client_id: item.clientId,
    started_at: p.started_at,
    timings: p.timings,
    instant_signs: p.instant_signs,
    pattern: p.pattern,
    result: p.result,
    result_reason: p.result_reason,
    week_at_start: p.week_at_start,
    config_version: p.config_version,
    source: "patient",
  });
  return error ? asFailure(error) : { ok: true };
}

/**
 * S06x: tell the server, once, that it refused this entry, so support can see it without the patient
 * having to read a code down the phone. Carries no health value (rejection-report.ts). Best effort: a
 * failure leaves the row unreported and the next flush tries again; the server ignores a repeat.
 */
async function reportIfNeeded(db: SQLite.SQLiteDatabase, item: OutboxItem, fresh?: FailureInfo): Promise<void> {
  try {
    if (reportedColumnReady) {
      const flag = await db.getFirstAsync<{ rejection_reported: number }>(
        "select rejection_reported from outbox where client_id = ?",
        [item.clientId]
      );
      if (flag?.rejection_reported === 1) return;
    }
    if (await reportOnHold(item.clientId)) return;
    let info = fresh;
    if (!info) {
      const stored = await db.getFirstAsync<{ last_status: number | null; last_error: string | null }>(
        "select last_status, last_error from outbox where client_id = ?",
        [item.clientId]
      );
      info = { status: stored?.last_status ?? undefined, message: stored?.last_error ?? undefined };
    }
    const outcome = await reportRejection(item, info);
    await applyReportOutcome(item.clientId, outcome);
    if (outcome === "sent" && reportedColumnReady) {
      await db.runAsync("update outbox set rejection_reported = 1 where client_id = ?", [item.clientId]);
    }
  } catch (error) {
    recordSyncError("offline_outbox", `reportRejection:${supportCode(item.clientId)}`, error);
  }
}

/** At most this many rejection reports per flush, so a pile of old rejected rows cannot make every flush slow. */
const MAX_REPORTS_PER_FLUSH = 5;

let flushing: Promise<FlushResult> | null = null;

/**
 * Drains the outbox oldest-first. Concurrent callers (a screen, the background
 * task) share one run so the same row is never in flight twice.
 */
export function flushOutbox(): Promise<FlushResult> {
  if (!flushing) {
    flushing = runFlush(false).finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

/**
 * S06z: sends everything held for Wi-Fi, whatever the connection. Used by the patient's "Send now on mobile data" and by the
 * last upload attempt before a phone is wiped (a held row must never be destroyed unsent). It waits for any run in progress
 * and then runs on its own, so the same row is never in flight twice and the override belongs to this run alone.
 */
export async function flushOutboxIncludingHeld(): Promise<FlushResult> {
  while (flushing) await flushing.catch(() => undefined);
  const run: Promise<FlushResult> = runFlush(true).finally(() => {
    if (flushing === run) flushing = null;
  });
  flushing = run;
  return run;
}

/** How many entries Wi-Fi only is holding back right now, by the same rule the flush uses. */
export async function countHeldForWifi(rows?: readonly OutboxItem[]): Promise<number> {
  try {
    const ctx = await loadHoldContext();
    if (!ctx.wifiOnly || ctx.connection !== "cellular") return 0;
    const userId = await currentUserId();
    const nowMs = Date.now();
    const items = rows ?? (await listAllOutbox());
    return items.filter((i) => i.state === "pending" && mayFlushUnder(i.ownerUserId, userId) && isHeldForWifi(i, ctx, nowMs)).length;
  } catch {
    return 0;
  }
}

/** What one run sent, counted once at the end (S06z) instead of once per row, against the connection it used. */
interface RunMeter {
  bytes: number;
  connection: ConnectionKind;
}

/**
 * Once an anchor change or a day shift has been sent, the person's anchors are read back from the server (S08z). The row leaves the
 * outbox when it is sent, so without this the phone would drop the change from its profile until the next routine pull, and resolve
 * anchored doses at the OLD time in between (and the server decides the effective date, which the phone should show too).
 */
async function runFlush(forced: boolean): Promise<FlushResult> {
  const meter: RunMeter = { bytes: 0, connection: "unknown" };
  const sentAnchors = new Set<string>();
  try {
    return await runFlushRows(forced, meter, sentAnchors);
  } finally {
    await addDataUsage(meter.bytes, new Date(), meter.connection);
    for (const subjectId of sentAnchors) await pullAnchorsFor(subjectId);
  }
}

async function runFlushRows(forced: boolean, meter: RunMeter, sentAnchors: Set<string>): Promise<FlushResult> {
  const db = await getDb();
  const userId = await currentUserId();
  const now = new Date();
  const items = await listAllOutbox();
  const result: FlushResult = { synced: 0, remaining: items.length, stoppedOffline: false, held: 0, newlyRejected: 0, heldForWifi: 0 };
  // S06z: the Wi-Fi-only choice, the connection and the configured values are read once per run. Any failure means "send".
  const hold = await loadHoldContext();
  // The meter attributes this run's bytes to the connection it used: one read per run, and only when there is something to send.
  meter.connection = items.length > 0 ? (hold.wifiOnly ? hold.connection : await getConnectionKind()) : "unknown";
  // Rejection reports (S06x) wait until every sendable row has gone: an urgent reading must never queue behind
  // two slow requests per old rejected row.
  const toReport: { item: OutboxItem; info?: FailureInfo }[] = [];

  for (const item of items) {
    if (!mayFlushUnder(item.ownerUserId, userId)) {
      result.held += 1;
      continue;
    }
    if (item.state === "rejected") {
      toReport.push({ item });
      continue;
    }
    const due = await db.getFirstAsync<{ next_attempt_at: string }>(
      "select next_attempt_at from outbox where client_id = ?",
      [item.clientId]
    );
    if (due && new Date(due.next_attempt_at).getTime() > now.getTime()) continue;

    // Only a dose log and a weight reading are ever held, and only on a known mobile connection (data-cost-rules.ts).
    if (isHeldForWifi(item, hold, now.getTime(), forced)) {
      result.heldForWifi += 1;
      continue;
    }

    const outcome = await send(item);
    if (outcome.ok) {
      await db.runAsync("delete from outbox where client_id = ?", [item.clientId]);
      meter.bytes += JSON.stringify(item.payload).length + 300;
      if (item.kind === "anchor_times" || item.kind === "day_shift" || item.kind === "day_shift_end") sentAnchors.add(item.subjectId);
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
      toReport.push({ item, info: outcome });
    } else {
      recordSyncError("offline_outbox", `${detail}:retry`, message);
      const wait = backoffMs(item.attempts + 1);
      await db.runAsync(
        "update outbox set attempts = attempts + 1, last_error = ?, last_status = ?, next_attempt_at = ? where client_id = ?",
        [message, outcome.status ?? null, new Date(now.getTime() + wait).toISOString(), item.clientId]
      );
    }
  }
  for (const r of toReport.slice(0, MAX_REPORTS_PER_FLUSH)) await reportIfNeeded(db, r.item, r.info);
  return result;
}
