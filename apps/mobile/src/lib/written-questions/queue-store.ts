import * as SQLite from "expo-sqlite";
import type { QueuedItem, QueueStore } from "./queue";
import { parseOrQuarantine } from "./queue-row";

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
    const rows = await db.getAllAsync<{ client_id: string; user_id: string; created_at: number; item: string }>(
      "select client_id, user_id, created_at, item from wq_queue where user_id = ? order by created_at asc",
      [userId],
    );
    const items: QueuedItem[] = rows.map((row) =>
      parseOrQuarantine({ clientId: row.client_id, userId: row.user_id, createdAt: row.created_at, item: row.item }),
    );
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
