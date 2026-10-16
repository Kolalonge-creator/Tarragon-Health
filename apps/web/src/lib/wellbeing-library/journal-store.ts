"use client";

import { JOURNAL_ALG, newJournalKey, type RandomBytes } from "@tarragon/shared/journal-crypto";

/**
 * Device storage for the private journal (S57, 10.8): IndexedDB in this browser. The key lives in its own store and is created here;
 * entries are stored already sealed, so what is on disk is ciphertext. This protects against the server, a backup, a screenshot of the
 * storage list and a casual look; it is not protection against someone who controls this browser profile. Nothing is sent anywhere
 * from this file.
 */
export interface StoredEntry {
  readonly id: string;
  readonly alg: typeof JOURNAL_ALG;
  readonly iv: string;
  readonly ciphertext: string;
  readonly updated_at: string; // ISO
}

export const browserRandom: RandomBytes = (n) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("tarragon.journal.v1", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("keys");
      req.result.createObjectStore("entries", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb unavailable"));
  });
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb error"));
  });
}

export async function getOrCreateKey(): Promise<Uint8Array> {
  const db = await open();
  const existing = await run<Uint8Array | undefined>(db, "keys", "readonly", (s) => s.get("key") as IDBRequest<Uint8Array | undefined>);
  if (existing && existing.length === 32) return existing;
  const key = newJournalKey(browserRandom);
  await run(db, "keys", "readwrite", (s) => s.put(key, "key"));
  return key;
}

export async function listSealed(): Promise<StoredEntry[]> {
  const db = await open();
  const all = await run<StoredEntry[]>(db, "entries", "readonly", (s) => s.getAll() as IDBRequest<StoredEntry[]>);
  return all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function putSealed(e: StoredEntry): Promise<void> {
  const db = await open();
  await run(db, "entries", "readwrite", (s) => s.put(e));
}

export async function deleteSealed(id: string): Promise<void> {
  const db = await open();
  await run(db, "entries", "readwrite", (s) => s.delete(id));
}
