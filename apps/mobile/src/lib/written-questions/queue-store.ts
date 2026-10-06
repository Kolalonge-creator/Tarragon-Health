import * as SQLite from "expo-sqlite";
import type { QueuedItem, QueueStore } from "./queue";

/**
 * SQLite persistence for the written-question queue (same on-device database as the S06 outbox and
 * drafts, separate tables). Photo bytes are the already cleaned JPEG, kept as blobs so no cache
 * cleaner can delete them. Sign-out does not touch these tables: an item belongs to its patient
 * and is only ever read back for that same patient.
 */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("tarragon-offline.db").then(async (db) => {
      await db.execAsync(
        `create table if not exists wq_queue (
           client_id text primary key,
           user_id text not null,
           created_at integer not null,
           item text not null
         );
         create table if not exists wq_queue_photos (
           client_id text not null,
           photo_id text not null,
           bytes blob not null,
           primary key (client_id, photo_id)
         );`,
      );
      return db;
    });
  }
  return dbPromise;
}

function parseItem(raw: string): QueuedItem | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const candidate = value as Partial<QueuedItem>;
    if (typeof candidate.clientId !== "string" || typeof candidate.userId !== "string") return null;
    return candidate as QueuedItem;
  } catch {
    return null;
  }
}

export const sqliteQueueStore: QueueStore = {
  async insert(item, photos) {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const p of photos) {
        await db.runAsync("insert or replace into wq_queue_photos (client_id, photo_id, bytes) values (?, ?, ?)", [
          item.clientId,
          p.id,
          p.bytes,
        ]);
      }
      await db.runAsync("insert or replace into wq_queue (client_id, user_id, created_at, item) values (?, ?, ?, ?)", [
        item.clientId,
        item.userId,
        item.createdAt,
        JSON.stringify(item),
      ]);
    });
  },
  async update(item) {
    const db = await getDb();
    await db.runAsync("update wq_queue set item = ? where client_id = ? and user_id = ?", [
      JSON.stringify(item),
      item.clientId,
      item.userId,
    ]);
  },
  async list(userId) {
    const db = await getDb();
    const rows = await db.getAllAsync<{ item: string }>(
      "select item from wq_queue where user_id = ? order by created_at asc",
      [userId],
    );
    const items: QueuedItem[] = [];
    for (const row of rows) {
      const parsed = parseItem(row.item);
      if (parsed) items.push(parsed);
    }
    return items;
  },
  async loadPhoto(clientId, photoId) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ bytes: Uint8Array }>(
      "select bytes from wq_queue_photos where client_id = ? and photo_id = ?",
      [clientId, photoId],
    );
    return row ? new Uint8Array(row.bytes) : null;
  },
  async remove(clientId) {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync("delete from wq_queue_photos where client_id = ?", [clientId]);
      await db.runAsync("delete from wq_queue where client_id = ?", [clientId]);
    });
  },
};
