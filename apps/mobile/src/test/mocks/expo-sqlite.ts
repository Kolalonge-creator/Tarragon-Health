/**
 * Stand-in for expo-sqlite backed by Node's own real SQLite engine
 * (`node:sqlite`, unflagged since Node 22.13 / 23.4 — CI runs Node 22, see
 * .github/workflows/ci.yml).
 *
 * Deliberately a real database rather than a hand-rolled fake that pattern-
 * matches the five statements offline-vitals-queue.ts happens to issue
 * today: the point of testing that queue is that a clinical reading is
 * never lost, and a fake SQL interpreter would keep passing if someone
 * changed the schema or a WHERE clause underneath it.
 */
import { DatabaseSync } from "node:sqlite";

type Params = readonly (string | number | null)[];

export interface SQLiteDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: Params): Promise<void>;
  getAllAsync<T>(sql: string, params?: Params): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: Params): Promise<T | null>;
  /** Runs the task inside one transaction: all of its writes commit together or none do. */
  withExclusiveTransactionAsync(task: (txn: SQLiteDatabase) => Promise<void>): Promise<void>;
  /** Same connection as everything else: other statements can interleave, as in expo-sqlite. */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

let failNextExclusive = false;
/** Test hook: the next exclusive transaction fails as it would when another connection holds the write lock. */
export function __failNextExclusiveTransaction(): void {
  failNextExclusive = true;
}

const databases = new Map<string, DatabaseSync>();

/**
 * SQLCipher stand-in. The real engine encrypts the file; here we model only what the app's logic depends on:
 * the first `PRAGMA key` on an EMPTY database fixes that database's key; opening it later with a different key (or
 * none, once keyed) fails on the first statement with "file is not a database"; keying a database that already holds
 * plain data fails the same way; `PRAGMA cipher_version` answers only when the build has SQLCipher.
 */
const dbKeys = new Map<string, string>();
let cipherAvailable = true;
/** Test hook: simulate a build without SQLCipher (a plain SQLite build ignores PRAGMA key silently). */
export function __setCipherAvailable(available: boolean): void {
  cipherAvailable = available;
}
/** Test hook: the key a named database was created with. */
export function __keyOf(name: string): string | undefined {
  return dbKeys.get(name);
}
/** Test hook: the database names that exist. */
export function __databaseNames(): string[] {
  return [...databases.keys()];
}

interface Conn {
  name: string;
  key: string | null;
  bad: boolean;
}

const KEY_PRAGMA = /^\s*pragma\s+key\s*=\s*"x'([0-9a-f]+)'"\s*;?\s*$/i;

function guard(db: DatabaseSync, conn: Conn): void {
  if (conn.bad) throw new Error("file is not a database");
  const expected = dbKeys.get(conn.name);
  if (expected !== undefined && conn.key !== expected) throw new Error("file is not a database");
}

function wrap(db: DatabaseSync, conn: Conn): SQLiteDatabase {
  return {
    async execAsync(sql) {
      const m = KEY_PRAGMA.exec(sql);
      if (m) {
        if (!cipherAvailable) return; // a plain SQLite build silently ignores the key
        const hasData = (db.prepare("select count(*) as n from sqlite_master").get() as { n: number }).n > 0;
        if (!dbKeys.has(conn.name)) {
          if (hasData) conn.bad = true;
          else dbKeys.set(conn.name, m[1]);
        }
        conn.key = m[1];
        return;
      }
      guard(db, conn);
      db.exec(sql);
    },
    async runAsync(sql, params = []) {
      guard(db, conn);
      db.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: Params = []) {
      guard(db, conn);
      if (/^\s*pragma\s+cipher_version/i.test(sql)) return (cipherAvailable ? [{ cipher_version: "4.5.0 community" }] : []) as T[];
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: Params = []) {
      guard(db, conn);
      if (/^\s*pragma\s+cipher_version/i.test(sql)) return (cipherAvailable ? { cipher_version: "4.5.0 community" } : null) as T | null;
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      guard(db, conn);
      db.exec("begin");
      try {
        await task();
        db.exec("commit");
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    },
    async withExclusiveTransactionAsync(task) {
      guard(db, conn);
      if (failNextExclusive) {
        failNextExclusive = false;
        throw new Error("database is locked");
      }
      db.exec("begin");
      try {
        await task(wrap(db, conn));
        db.exec("commit");
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    },
    async closeAsync() {
      // Handles share one engine per name in this stand-in; closing a handle must not close the engine.
    },
  };
}

export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> {
  let db = databases.get(name);
  if (!db) {
    db = new DatabaseSync(":memory:");
    databases.set(name, db);
  }
  return wrap(db, { name, key: null, bad: false });
}

export async function deleteDatabaseAsync(name: string): Promise<void> {
  const db = databases.get(name);
  if (!db) throw new Error(`database ${name} does not exist`);
  db.close();
  databases.delete(name);
  dbKeys.delete(name);
}

/**
 * Throws every database away between tests (SQLCipher keys with them). Modules never hold a handle across
 * calls: they ask secure-db.ts, whose memo jest.setup.ts resets in the same hook.
 */
export function __reset(): void {
  for (const db of databases.values()) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  databases.clear();
  dbKeys.clear();
  cipherAvailable = true;
  failNextExclusive = false;
}
