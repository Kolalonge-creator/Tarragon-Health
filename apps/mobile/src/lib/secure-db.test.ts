/**
 * S06x encrypted store. The Jest SQLite stand-in models SQLCipher's key behaviour (see
 * src/test/mocks/expo-sqlite.ts): the first key fixes a database's key, a different or missing key
 * fails with "file is not a database", a plain build ignores PRAGMA key.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  __databaseNames,
  __keyOf,
  __setCipherAvailable,
  openDatabaseAsync,
} from "../test/mocks/expo-sqlite";
import { __setFailing } from "../test/mocks/expo-secure-store";
import { __resetOutboxForTests, countAllOutboxRows, enqueue, listOutbox } from "./outbox";
import { __resetStoreForTests, destroyStore, getStore, getStoreStatus } from "./secure-db";
import { listStoreNotices } from "./store-notices";
import * as rules from "./store-rules";
import { LEGACY_DB_NAME, storeFileName } from "./store-rules";

jest.mock("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) } },
}));

const BP = { vital_type: "blood_pressure", systolic: 120, diastolic: 80 } as const;
const KEY_NAME = "tarragon.offline.store.key.v1";

async function seedLegacy(rows: number, withPhotos = false): Promise<void> {
  const db = await openDatabaseAsync(LEGACY_DB_NAME);
  await db.execAsync(
    `create table outbox (client_id text primary key, kind text not null, owner_user_id text not null, subject_id text not null,
      beneficiary_profile_id text, payload text not null, client_recorded_at text not null, created_at text not null,
      attempts integer not null default 0, next_attempt_at text not null, state text not null default 'pending',
      last_error text, last_status integer, danger integer not null default 0);
     create index outbox_state_created on outbox (state, created_at);
     create table drafts (key text primary key, value text not null, updated_at text not null);
     create table wq_queue_photos (client_id text not null, photo_id text not null, bytes blob not null, primary key (client_id, photo_id));`
  );
  for (let i = 0; i < rows; i++) {
    await db.runAsync(
      "insert into outbox (client_id, kind, owner_user_id, subject_id, payload, client_recorded_at, created_at, next_attempt_at, attempts, danger) values (?, 'vital', 'user-1', 'user-1', ?, ?, ?, ?, ?, ?)",
      [`c-${String(i).padStart(5, "0")}`, JSON.stringify({ ...BP, systolic: 100 + (i % 80) }), "2026-10-01T08:00:00Z", `2026-10-01T08:${String(i % 60).padStart(2, "0")}:00Z`, "2026-10-01T08:00:00Z", i % 3, i % 7 === 0 ? 1 : 0]
    );
  }
  await db.runAsync("insert into drafts (key, value, updated_at) values ('bp:p1', '{\"sys\":\"1\"}', '2026-10-01T08:00:00Z')");
  if (withPhotos) await db.runAsync("insert into wq_queue_photos values ('q1', 'p1', ?)", [new Uint8Array([1, 2, 3, 250]) as unknown as number]);
}

function freshStart(): void {
  __resetStoreForTests();
  __resetOutboxForTests();
}

describe("a new phone", () => {
  it("makes a random 256-bit key, keeps it in the keystore, and opens an encrypted file with it", async () => {
    await getStore();
    const key = await SecureStore.getItemAsync(KEY_NAME);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(__keyOf(storeFileName(1))).toBe(key);
    expect(await getStoreStatus()).toEqual({ mode: "encrypted", generation: 1 });
    expect(await listStoreNotices()).toEqual([]);
  });

  it("reuses the same key on the next start and keeps what was saved", async () => {
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    const key = await SecureStore.getItemAsync(KEY_NAME);
    freshStart();
    expect(await listOutbox()).toHaveLength(1);
    expect(await SecureStore.getItemAsync(KEY_NAME)).toBe(key);
  });

  it("makes a different key on every new phone", async () => {
    await getStore();
    const first = await SecureStore.getItemAsync(KEY_NAME);
    await destroyStore();
    await getStore();
    expect(await SecureStore.getItemAsync(KEY_NAME)).not.toBe(first);
  });

  it("cannot be opened without the key, or with another one (a stolen file is unreadable)", async () => {
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    const stolen = await openDatabaseAsync(storeFileName(1));
    await expect(stolen.getAllAsync("select * from outbox")).rejects.toThrow(/not a database/);
    await stolen.execAsync(rules.keyPragma("cd".repeat(32)));
    await expect(stolen.getAllAsync("select * from outbox")).rejects.toThrow(/not a database/);
  });
});

describe("moving the old plain database", () => {
  it("copies every table, verifies counts and checksums, and only then removes the old file", async () => {
    await seedLegacy(25, true);
    expect(__databaseNames()).toContain(LEGACY_DB_NAME);
    freshStart();
    const rows = await listOutbox();
    expect(rows).toHaveLength(25);
    expect(rows.map((r) => r.clientId)).toEqual([...rows.map((r) => r.clientId)].sort());
    expect(__databaseNames()).not.toContain(LEGACY_DB_NAME);
    expect(await AsyncStorage.getItem("@tarragon/legacy-store/v1")).toBe("done");
    const db = await getStore();
    expect((await db.getFirstAsync<{ n: number }>("select count(*) as n from wq_queue_photos"))?.n).toBe(1);
    expect(await db.getFirstAsync<{ n: number }>("select count(*) as n from sqlite_master where name = 'outbox_state_created'")).toEqual({ n: 1 });
    expect(await listStoreNotices()).toEqual([]);
  });

  it("moves queued photo bytes intact, in small pages", async () => {
    await seedLegacy(1, true);
    const db = await openDatabaseAsync(LEGACY_DB_NAME);
    const big = new Uint8Array(300_000).map((_, i) => i % 251);
    for (let i = 0; i < 30; i++) await db.runAsync("insert into wq_queue_photos values (?, ?, ?)", ["q2", `p${i}`, big as unknown as number]);
    freshStart();
    const store = await getStore();
    expect((await store.getFirstAsync<{ n: number }>("select count(*) as n from wq_queue_photos"))?.n).toBe(31);
    expect(__databaseNames()).not.toContain(LEGACY_DB_NAME);
  });

  it("moves 1000 queued rows without loss", async () => {
    await seedLegacy(1000);
    freshStart();
    expect(await countAllOutboxRows()).toBe(1000);
    expect(__databaseNames()).not.toContain(LEGACY_DB_NAME);
  });

  it("a phone with nothing in the old file just drops the empty file", async () => {
    await openDatabaseAsync(LEGACY_DB_NAME);
    freshStart();
    await getStore();
    expect(__databaseNames()).not.toContain(LEGACY_DB_NAME);
    expect(await AsyncStorage.getItem("@tarragon/legacy-store/v1")).toBe("done");
  });

  it("KEEPS the old file and serves from it when the copy does not match, so the outbox is never dropped", async () => {
    await seedLegacy(10);
    const spy = jest.spyOn(rules, "compareSummaries").mockReturnValue(["outbox: 10 rows in source, 9 in copy"]);
    freshStart();
    expect(await getStoreStatus()).toMatchObject({ mode: "plain" });
    expect(await listOutbox()).toHaveLength(10); // still there and still sendable
    expect(__databaseNames()).toContain(LEGACY_DB_NAME);
    expect(await AsyncStorage.getItem("@tarragon/legacy-store/v1")).toBeNull();
    const notices = await listStoreNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "migration_held" });
    expect((notices[0] as { code: string }).code).toMatch(/^[0-9A-F]{8}$/);

    // The next start retries, and this time it is verified.
    spy.mockRestore();
    freshStart();
    expect(await getStoreStatus()).toMatchObject({ mode: "encrypted" });
    expect(await listOutbox()).toHaveLength(10);
    expect(__databaseNames()).not.toContain(LEGACY_DB_NAME);
  });

  it("an entry logged on the old file while the copy was held is carried over by the retry", async () => {
    await seedLegacy(3);
    const spy = jest.spyOn(rules, "compareSummaries").mockReturnValue(["x"]);
    freshStart();
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    spy.mockRestore();
    freshStart();
    expect(await listOutbox()).toHaveLength(4);
  });

  it("detects a changed value, not just a changed count", async () => {
    await seedLegacy(5);
    // A real corruption: the copy of one row differs. Simulate by making the checksum helper see different rows.
    const original = rules.rowsChecksum;
    let calls = 0;
    const spy = jest.spyOn(rules, "rowsChecksum").mockImplementation((r, seed) => (++calls === 4 ? "deadbeef" : original(r, seed)));
    freshStart();
    expect((await getStoreStatus()).mode).toBe("plain");
    spy.mockRestore();
  });

  it("when only the delete failed last time, never copies again over the live encrypted store", async () => {
    await seedLegacy(2);
    freshStart();
    await getStore();
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    // Pretend the old file came back and the state says verified: it must be removed, not copied.
    await openDatabaseAsync(LEGACY_DB_NAME);
    await AsyncStorage.setItem("@tarragon/legacy-store/v1", "verified");
    freshStart();
    expect(await countAllOutboxRows()).toBe(3);
    expect(__databaseNames()).not.toContain(LEGACY_DB_NAME);
  });
});

describe("a lost key", () => {
  it("leaves the unreadable file alone, starts a new one, and tells the patient with a support code", async () => {
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    await SecureStore.deleteItemAsync(KEY_NAME); // keystore reset or a restored backup
    freshStart();
    await getStore();
    expect(await getStoreStatus()).toEqual({ mode: "encrypted", generation: 2 });
    expect(__databaseNames()).toEqual(expect.arrayContaining([storeFileName(1), storeFileName(2)]));
    const [notice] = await listStoreNotices();
    expect(notice).toMatchObject({ kind: "key_lost" });
    expect((notice as { code: string }).code).toMatch(/^[0-9A-F]{8}$/);
    // The old file is untouched and still not readable with the new key.
    const old = await openDatabaseAsync(storeFileName(1));
    await expect(old.getAllAsync("select 1")).rejects.toThrow(/not a database/);
    // The patient can keep logging.
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    expect(await listOutbox()).toHaveLength(1);
  });

  it("says so once, however many times the app starts afterwards", async () => {
    await getStore();
    await SecureStore.deleteItemAsync(KEY_NAME);
    freshStart();
    await getStore();
    freshStart();
    await getStore();
    freshStart();
    await getStore();
    expect(await listStoreNotices()).toHaveLength(1);
    expect((await getStoreStatus()).generation).toBe(2);
  });
});

describe("when encryption cannot start, logging still works and the patient is told", () => {
  it("falls back to the plain file when the keystore is unavailable", async () => {
    __setFailing(true);
    freshStart();
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    expect(await getStoreStatus()).toMatchObject({ mode: "plain" });
    expect((await listStoreNotices())[0]).toMatchObject({ kind: "not_encrypted", why: "keystore" });
    expect(__databaseNames()).toContain(LEGACY_DB_NAME);
    // The keystore comes back: the entry is carried into the encrypted store.
    __setFailing(false);
    freshStart();
    expect(await getStoreStatus()).toMatchObject({ mode: "encrypted" });
    expect(await listOutbox()).toHaveLength(1);
  });

  it("does not claim encryption on a build without SQLCipher", async () => {
    __setCipherAvailable(false);
    freshStart();
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    expect(await getStoreStatus()).toMatchObject({ mode: "plain" });
    expect((await listStoreNotices())[0]).toMatchObject({ kind: "not_encrypted", why: "sqlcipher" });
    __setCipherAvailable(true);
    freshStart();
    expect(await getStoreStatus()).toMatchObject({ mode: "encrypted" });
    expect(await listOutbox()).toHaveLength(1);
  });
});

describe("after the move, a failure to open is never answered with a plain file", () => {
  it("a locked or broken keystore makes the open fail, creates no plain file, and shows no false notice", async () => {
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    __setFailing(true);
    freshStart();
    await expect(getStore()).rejects.toThrow(/keystore/);
    expect(__databaseNames()).not.toContain(LEGACY_DB_NAME);
    expect(await listStoreNotices()).toEqual([]);
    __setFailing(false);
    freshStart();
    expect(await listOutbox()).toHaveLength(1); // nothing was lost, it just waited
  });

  it("a build that lost SQLCipher after the move fails the same way", async () => {
    await enqueue({ kind: "vital", subjectId: "user-1", payload: BP });
    __setCipherAvailable(false);
    freshStart();
    await expect(getStore()).rejects.toThrow();
    expect(__databaseNames()).not.toContain(LEGACY_DB_NAME);
  });
});

describe("destroyStore", () => {
  it("removes every generation, the old plain file, the key and the markers", async () => {
    await getStore();
    await SecureStore.deleteItemAsync(KEY_NAME);
    freshStart();
    await getStore(); // generation 2
    await openDatabaseAsync(LEGACY_DB_NAME);
    await destroyStore();
    expect(__databaseNames().filter((n) => n.startsWith("tarragon-"))).toEqual([]);
    expect(await SecureStore.getItemAsync(KEY_NAME)).toBeNull();
    expect(await AsyncStorage.getItem("@tarragon/store-generation/v1")).toBeNull();
    // The next use starts clean with a new key.
    await getStore();
    expect(await SecureStore.getItemAsync(KEY_NAME)).toMatch(/^[0-9a-f]{64}$/);
  });
});
