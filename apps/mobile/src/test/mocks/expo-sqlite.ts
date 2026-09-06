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
}

const databases = new Map<string, DatabaseSync>();

function wrap(db: DatabaseSync): SQLiteDatabase {
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: Params = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: Params = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
}

export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> {
  let db = databases.get(name);
  if (!db) {
    db = new DatabaseSync(":memory:");
    databases.set(name, db);
  }
  return wrap(db);
}

/**
 * Empties every table instead of closing and discarding the database:
 * offline-vitals-queue.ts memoises its `openDatabaseAsync` promise at module
 * scope and only runs its `create table if not exists` once, so a closed (or
 * replaced) handle would leave every test after the first talking to a dead
 * database rather than a clean one.
 */
export function __reset(): void {
  for (const db of databases.values()) {
    const tables = db
      .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
      .all() as { name: string }[];
    for (const { name } of tables) db.exec(`delete from "${name}"`);
  }
}
