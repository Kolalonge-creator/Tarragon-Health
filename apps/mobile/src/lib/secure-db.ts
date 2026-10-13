import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { recordSyncError } from "./sync-diagnostics";
import { deleteStoreKey, getOrCreateStoreKey } from "./store-key";
import { addStoreNotice } from "./store-notices";
import {
  LEGACY_DB_NAME,
  compareSummaries,
  eventCode,
  isWrongKeyError,
  keyPragma,
  rowsChecksum,
  storeFileName,
  type TableSummary,
} from "./store-rules";

/**
 * The one on-device database (S06x, decision D1). Every module that keeps patient data on the phone
 * (outbox, read mirror, drafts, written-question queue) gets its handle from getStoreWithSchema.
 *
 *  - The file is SQLCipher, keyed with a random 256-bit key held in the OS keychain (store-key.ts). A
 *    stolen phone's file cannot be read without it.
 *  - A phone that already has the old plain database (tarragon-offline.db) is migrated once: every table
 *    is copied, row counts and a checksum of every table are compared, and only then is the old file
 *    removed. If anything differs the old file is KEPT and used as the store for this run, so the
 *    outbox keeps flushing and nothing is dropped; the copy is retried on the next start.
 *  - If the key is gone but the encrypted file is still there (a restored backup, a keystore reset),
 *    the unreadable file is left untouched, a new generation is started and the patient is shown a
 *    support code. The outbox is never silently emptied: the notice says entries on this phone could
 *    not be opened.
 *  - If the keystore or SQLCipher is unavailable the old plain database is used and the patient is
 *    told it is not encrypted. Logging never stops because encryption could not start.
 */

const GENERATION_KEY = "@tarragon/store-generation/v1";
const LEGACY_STATE_KEY = "@tarragon/legacy-store/v1";
const COPY_PAGE = 200;

export type StoreMode = "encrypted" | "plain";

class CipherUnavailableError extends Error {
  constructor() {
    super("This build has no SQLCipher");
    this.name = "CipherUnavailableError";
  }
}

class MigrationVerifyError extends Error {
  constructor(readonly problems: string[]) {
    super(`The encrypted copy did not match: ${problems.join("; ")}`);
    this.name = "MigrationVerifyError";
  }
}

interface OpenStore {
  db: SQLite.SQLiteDatabase;
  mode: StoreMode;
  generation: number;
  name: string;
}

let opening: Promise<OpenStore> | null = null;
let current: OpenStore | null = null;
const schemas = new WeakMap<object, Map<string, Promise<void>>>();

async function readGeneration(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(GENERATION_KEY);
    const n = raw ? Number(raw) : 1;
    return Number.isInteger(n) && n >= 1 ? n : 1;
  } catch {
    return 1;
  }
}

async function openEncrypted(name: string, hexKey: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(name);
  try {
    await db.execAsync(keyPragma(hexKey));
    // Any read proves the key: a wrong key fails here with "file is not a database".
    await db.getFirstAsync("select count(*) as n from sqlite_master");
    // A plain SQLite build ignores PRAGMA key without complaint, so ask the engine whether it is SQLCipher.
    const cipher = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version");
    if (!cipher?.cipher_version) throw new CipherUnavailableError();
    return db;
  } catch (error) {
    await db.closeAsync().catch(() => {});
    throw error;
  }
}

async function openPlainFallback(why: "keystore" | "sqlcipher", cause: unknown): Promise<OpenStore> {
  recordSyncError("offline_outbox", `store:plainFallback:${why}`, cause);
  await addStoreNotice({ kind: "not_encrypted", why });
  const db = await SQLite.openDatabaseAsync(LEGACY_DB_NAME);
  return { db, mode: "plain", generation: 0, name: LEGACY_DB_NAME };
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function listTables(db: SQLite.SQLiteDatabase): Promise<{ name: string; sql: string }[]> {
  return db.getAllAsync<{ name: string; sql: string }>(
    "select name, sql from sqlite_master where type = 'table' and name not like 'sqlite_%' and sql is not null order by name"
  );
}

async function columnsOf(db: SQLite.SQLiteDatabase, table: string): Promise<string[]> {
  const cols = await db.getAllAsync<{ name: string }>(`pragma table_info(${quote(table)})`);
  return cols.map((c) => c.name);
}

async function summarize(db: SQLite.SQLiteDatabase, table: string): Promise<TableSummary> {
  const cols = await columnsOf(db, table);
  let count = 0;
  let checksum = "";
  for (let offset = 0; ; offset += COPY_PAGE) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `select * from ${quote(table)} order by rowid limit ${COPY_PAGE} offset ${offset}`
    );
    if (rows.length === 0) break;
    count += rows.length;
    checksum = rowsChecksum(
      rows.map((r) => cols.map((c) => r[c])),
      checksum
    );
    if (rows.length < COPY_PAGE) break;
  }
  return { table, count, checksum };
}

async function copyAll(src: SQLite.SQLiteDatabase, dest: SQLite.SQLiteDatabase): Promise<TableSummary[]> {
  const tables = await listTables(src);
  const indexes = await src.getAllAsync<{ sql: string }>(
    "select sql from sqlite_master where type = 'index' and sql is not null and name not like 'sqlite_%'"
  );
  const summaries: TableSummary[] = [];
  for (const t of tables) {
    // A retry after a failed attempt starts from nothing: the copy is only ever a copy.
    await dest.execAsync(`drop table if exists ${quote(t.name)}`);
    await dest.execAsync(t.sql);
    const cols = await columnsOf(src, t.name);
    const insert = `insert into ${quote(t.name)} (${cols.map(quote).join(", ")}) values (${cols.map(() => "?").join(", ")})`;
    for (let offset = 0; ; offset += COPY_PAGE) {
      const rows = await src.getAllAsync<Record<string, unknown>>(
        `select * from ${quote(t.name)} order by rowid limit ${COPY_PAGE} offset ${offset}`
      );
      if (rows.length === 0) break;
      await dest.withTransactionAsync(async () => {
        for (const r of rows) await dest.runAsync(insert, cols.map((c) => r[c]) as (string | number | null)[]);
      });
      if (rows.length < COPY_PAGE) break;
    }
    summaries.push(await summarize(src, t.name));
  }
  for (const i of indexes) await dest.execAsync(i.sql);
  return summaries;
}

async function removeLegacyFile(): Promise<boolean> {
  try {
    await SQLite.deleteDatabaseAsync(LEGACY_DB_NAME);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|no such file|not exist/i.test(message)) return true;
    recordSyncError("offline_outbox", "store:removeLegacy", error);
    return false;
  }
}

/**
 * Carries the old plain database into the encrypted one. Returns true when the encrypted store is now
 * the complete store (copy verified, or there was nothing to copy); false when the old file must keep
 * serving as the store for this run.
 */
async function migrateLegacy(dest: SQLite.SQLiteDatabase): Promise<boolean> {
  let state: string | null = null;
  try {
    state = await AsyncStorage.getItem(LEGACY_STATE_KEY);
  } catch {
    // treated as not started: a second verified copy is harmless
  }
  if (state === "done") return true;
  if (state === "verified") {
    // The copy was verified on an earlier start and only the delete failed. Never copy again: the encrypted store is in use.
    if (await removeLegacyFile()) await AsyncStorage.setItem(LEGACY_STATE_KEY, "done").catch(() => {});
    return true;
  }

  let src: SQLite.SQLiteDatabase;
  try {
    src = await SQLite.openDatabaseAsync(LEGACY_DB_NAME);
  } catch (error) {
    recordSyncError("offline_outbox", "store:openLegacy", error);
    return false;
  }
  try {
    const tables = await listTables(src);
    if (tables.length > 0) {
      const sourceSummaries = await copyAll(src, dest);
      const copySummaries: TableSummary[] = [];
      for (const t of tables) copySummaries.push(await summarize(dest, t.name));
      const problems = compareSummaries(sourceSummaries, copySummaries);
      if (problems.length > 0) throw new MigrationVerifyError(problems);
    }
    await AsyncStorage.setItem(LEGACY_STATE_KEY, "verified");
    await src.closeAsync().catch(() => {});
    if (await removeLegacyFile()) await AsyncStorage.setItem(LEGACY_STATE_KEY, "done").catch(() => {});
    return true;
  } catch (error) {
    await src.closeAsync().catch(() => {});
    const code = eventCode(Crypto.randomUUID());
    recordSyncError("offline_outbox", `store:migrate:${code}`, error);
    await addStoreNotice({ kind: "migration_held", code });
    return false;
  }
}

async function openStore(): Promise<OpenStore> {
  let key;
  try {
    key = await getOrCreateStoreKey();
  } catch (error) {
    return openPlainFallback("keystore", error);
  }

  let generation = await readGeneration();
  let db: SQLite.SQLiteDatabase;
  try {
    db = await openEncrypted(storeFileName(generation), key.hex);
  } catch (error) {
    if (error instanceof CipherUnavailableError) return openPlainFallback("sqlcipher", error);
    if (!isWrongKeyError(error)) throw error;
    // The file exists and this key does not open it. Leave it exactly as it is and start the next generation.
    const code = eventCode(Crypto.randomUUID());
    recordSyncError("offline_outbox", `store:keyLost:${code}`, error);
    await addStoreNotice({ kind: "key_lost", code });
    generation += 1;
    await AsyncStorage.setItem(GENERATION_KEY, String(generation));
    db = await openEncrypted(storeFileName(generation), key.hex);
  }

  const complete = await migrateLegacy(db);
  if (!complete) {
    // Escape hatch: the old file still holds the outbox. Serve it, retry the copy next start.
    await db.closeAsync().catch(() => {});
    const plain = await SQLite.openDatabaseAsync(LEGACY_DB_NAME);
    return { db: plain, mode: "plain", generation: 0, name: LEGACY_DB_NAME };
  }
  return { db, mode: "encrypted", generation, name: storeFileName(generation) };
}

/** The shared handle. A failed open is not remembered: the next call tries again. */
export function getStore(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = openStore()
      .then((s) => {
        current = s;
        return s;
      })
      .catch((error) => {
        opening = null;
        throw error;
      });
  }
  return opening.then((s) => s.db);
}

/**
 * The shared handle with a module's tables created. `setup` runs once per open handle, so a store that is
 * reopened after a wipe gets its tables back without each module tracking it.
 */
export async function getStoreWithSchema(name: string, setup: (db: SQLite.SQLiteDatabase) => Promise<void>): Promise<SQLite.SQLiteDatabase> {
  const db = await getStore();
  let perDb = schemas.get(db);
  if (!perDb) {
    perDb = new Map();
    schemas.set(db, perDb);
  }
  let done = perDb.get(name);
  if (!done) {
    done = setup(db).catch((error) => {
      perDb?.delete(name);
      throw error;
    });
    perDb.set(name, done);
  }
  await done;
  return db;
}

export interface StoreStatus {
  mode: StoreMode;
  generation: number;
}

export async function getStoreStatus(): Promise<StoreStatus> {
  await getStore();
  return { mode: current?.mode ?? "plain", generation: current?.generation ?? 0 };
}

/**
 * Removes every trace of the store from the phone: the open file, every earlier generation, the old
 * plain file, the key and the markers. Used by the remote wipe (device-lease.ts). Does not touch
 * notices (they must outlive the wipe) or the sign-in.
 */
export async function destroyStore(): Promise<void> {
  const generation = current?.generation ?? (await readGeneration());
  try {
    await current?.db.closeAsync();
  } catch {
    // closing a handle that is already broken is fine
  }
  opening = null;
  current = null;
  const names = [LEGACY_DB_NAME];
  for (let g = 1; g <= Math.max(generation, (await readGeneration())); g++) names.push(storeFileName(g));
  for (const name of names) {
    try {
      await SQLite.deleteDatabaseAsync(name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/does not exist|no such file|not exist/i.test(message)) throw error;
    }
  }
  await deleteStoreKey();
  await AsyncStorage.multiRemove([GENERATION_KEY, LEGACY_STATE_KEY]);
}

/** Test hook: forget the open handle so the next call re-runs key lookup, open and migration. */
export function __resetStoreForTests(): void {
  opening = null;
  current = null;
}
