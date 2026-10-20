/**
 * S06y: the upload queues move from AsyncStorage (clear) into the SQLCipher store. These tests pin the data-loss
 * edges of that move: nothing queued is ever dropped, a mismatch keeps the old list serving, a lost key never
 * resurrects or hides entries, accounts never see each other's, and the remote wipe removes the lot.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as sqliteMock from "../test/mocks/expo-sqlite";
import { __databaseNames, __setCipherAvailable } from "../test/mocks/expo-sqlite";
import {
  LEGACY_QUEUE_KEYS,
  MAX_QUEUE_SIZE,
  __resetQueueOwnerForTests,
  appendQueue,
  checksumRows,
  countQueuedByOwner,
  listQueue,
  planLegacyRows,
  removeFromQueueStore,
} from "./offline-queue-store";
import { __resetStoreForTests, destroyStore, getStore } from "./secure-db";
import { listStoreNotices } from "./store-notices";
import * as rules from "./store-rules";

let mockUser: string | null = "user-1";
let mockSessionError: { name: string; message: string } | null = null;
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null }, error: mockUser ? null : mockSessionError }) },
  },
}));

const KEY_NAME = "tarragon.offline.store.key.v1";
const DEVICE = LEGACY_QUEUE_KEYS.device_readings;

function legacyList(n: number, prefix = "e"): string {
  return JSON.stringify(
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${String(i).padStart(5, "0")}`,
      enqueuedAt: new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + i * 1000).toISOString(),
      item: { systolic: 100 + (i % 80), n: i },
    }))
  );
}

async function rowCount(): Promise<number> {
  const db = await getStore();
  return (await db.getFirstAsync<{ n: number }>("select count(*) as n from offline_queue_v1"))?.n ?? 0;
}

function restart(): void {
  __resetStoreForTests();
}

beforeEach(() => {
  mockUser = "user-1";
  mockSessionError = null;
  __resetQueueOwnerForTests();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("planLegacyRows", () => {
  it("makes exactly one row per element, readable or not, and the checksum is order sensitive", () => {
    const raw = JSON.stringify([{ id: "a", enqueuedAt: "t1", item: { x: 1 } }, { broken: true }, null, { id: "a", enqueuedAt: "t2", item: { y: 2 } }]);
    const rows = planLegacyRows("device_readings", raw);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.readable)).toEqual([1, 0, 0, 1]);
    expect(rows[3].id).toBe("a#2"); // a repeated id keeps both entries
    expect(checksumRows(rows)).not.toBe(checksumRows([...rows].reverse()));
  });
});

describe("moving the old AsyncStorage lists", () => {
  it("carries 1000 queued entries across with order, count and checksum intact, then removes the old list", async () => {
    await AsyncStorage.setItem(DEVICE, legacyList(1000));
    const entries = await listQueue<{ n: number }>("device_readings", "ble");
    expect(entries).toHaveLength(1000);
    expect(entries.map((e) => e.item.n)).toEqual(Array.from({ length: 1000 }, (_, i) => i));
    expect(await AsyncStorage.getItem(DEVICE)).toBeNull();
    expect(await rowCount()).toBe(1000);
    const db = await getStore();
    const marker = await db.getFirstAsync<{ state: string; entries: number }>("select state, entries from offline_queue_migration where queue = 'device_readings'");
    expect(marker).toEqual({ state: "done", entries: 1000 });
  });

  it("moves all three queues and an empty phone is a no-op", async () => {
    expect(await listQueue("health_samples", "ble")).toEqual([]);
    expect(await rowCount()).toBe(0);
    await destroyStore();
    await AsyncStorage.setItem(LEGACY_QUEUE_KEYS.health_samples, legacyList(3, "h"));
    await AsyncStorage.setItem(LEGACY_QUEUE_KEYS.photo_readings, legacyList(2, "p"));
    expect(await listQueue("health_samples", "ble")).toHaveLength(3);
    expect(await listQueue("photo_readings", "ble")).toHaveLength(2);
    expect(await AsyncStorage.getItem(LEGACY_QUEUE_KEYS.health_samples)).toBeNull();
    expect(await AsyncStorage.getItem(LEGACY_QUEUE_KEYS.photo_readings)).toBeNull();
  });

  it("on a checksum mismatch rolls the copy back, keeps the old list, keeps serving its entries, and tells the patient", async () => {
    await AsyncStorage.setItem(DEVICE, legacyList(40));
    const real = rules.rowsChecksum;
    let calls = 0;
    jest.spyOn(rules, "rowsChecksum").mockImplementation((rows, seed) => (++calls === 2 ? "deadbeef" : real(rows, seed)));
    const entries = await listQueue<{ n: number }>("device_readings", "ble");
    expect(entries).toHaveLength(40); // still served from the old list
    expect(await AsyncStorage.getItem(DEVICE)).not.toBeNull();
    expect(await rowCount()).toBe(0); // the half copy is gone
    expect((await listStoreNotices()).map((n) => n.kind)).toEqual(["migration_held"]);

    // New entries land in the store, the old ones are still listed, and removing one removes it from where it lives.
    expect(await appendQueue("device_readings", { n: 99 }, "ble")).toBe(true);
    const merged = await listQueue<{ n: number }>("device_readings", "ble");
    expect(merged).toHaveLength(41);
    await removeFromQueueStore("device_readings", "e-00000", "ble");
    await removeFromQueueStore("device_readings", merged[40].id, "ble");
    expect(await listQueue("device_readings", "ble")).toHaveLength(39);

    // The next start retries a fresh copy and now succeeds; nothing was lost on the way.
    jest.restoreAllMocks();
    restart();
    const after = await listQueue<{ n: number }>("device_readings", "ble");
    expect(after).toHaveLength(39);
    expect(await AsyncStorage.getItem(DEVICE)).toBeNull();
  });

  it("if only the delete of the old list fails, the next start deletes it and never copies twice", async () => {
    await AsyncStorage.setItem(DEVICE, legacyList(5));
    const realRemove = AsyncStorage.removeItem.bind(AsyncStorage);
    const remove = jest.spyOn(AsyncStorage, "removeItem").mockImplementation(async (k: string) => {
      if (k === DEVICE) throw new Error("disk busy");
      return realRemove(k);
    });
    expect(await listQueue("device_readings", "ble")).toHaveLength(5);
    expect(await AsyncStorage.getItem(DEVICE)).not.toBeNull();
    // Patient sends one entry meanwhile.
    const first = (await listQueue("device_readings", "ble"))[0];
    await removeFromQueueStore("device_readings", first.id, "ble");
    remove.mockRestore();
    restart();
    expect(await listQueue("device_readings", "ble")).toHaveLength(4); // the sent one is NOT copied back
    expect(await AsyncStorage.getItem(DEVICE)).toBeNull();
    expect(await rowCount()).toBe(4);
  });

  it("keeps a damaged list as an opaque encrypted row rather than dropping it, and never lists or counts it", async () => {
    await AsyncStorage.setItem(DEVICE, "[[[[");
    expect(await listQueue("device_readings", "ble")).toEqual([]);
    expect(await AsyncStorage.getItem(DEVICE)).toBeNull();
    expect(await rowCount()).toBe(1);
    expect(await countQueuedByOwner()).toEqual([]);
  });

  it("entries from before the change belong to the first account that signs in", async () => {
    mockUser = null;
    await AsyncStorage.setItem(DEVICE, legacyList(2));
    expect(await listQueue("device_readings", "ble")).toEqual([]); // nobody signed in sees nothing
    mockUser = "user-2";
    expect(await listQueue("device_readings", "ble")).toHaveLength(2);
    mockUser = "user-1";
    expect(await listQueue("device_readings", "ble")).toEqual([]);
  });

  it("with the key lost, a new empty store starts and the old queue is neither resurrected nor an error", async () => {
    await appendQueue("device_readings", { n: 1 }, "ble");
    await SecureStore.deleteItemAsync(KEY_NAME);
    restart();
    expect(await listQueue("device_readings", "ble")).toEqual([]);
    expect((await listStoreNotices()).map((n) => n.kind)).toContain("key_lost");
    expect(await appendQueue("device_readings", { n: 2 }, "ble")).toBe(true);
    expect(await listQueue("device_readings", "ble")).toHaveLength(1);
  });
});

describe("fail-silent and data-loss edges", () => {
  it("a reading taken offline with an expired token (session null WITH a fetch error) is still queued under the last account", async () => {
    await appendQueue("device_readings", { n: 1 }, "ble");
    mockUser = null;
    mockSessionError = { name: "AuthRetryableFetchError", message: "Network request failed" };
    expect(await appendQueue("device_readings", { n: 2 }, "ble")).toBe(true);
    expect(await listQueue("device_readings", "ble")).toHaveLength(2);
    // A real sign-out has no error: nothing is shown and nothing is queued.
    mockSessionError = null;
    expect(await listQueue("device_readings", "ble")).toEqual([]);
    expect(await appendQueue("device_readings", { n: 3 }, "ble")).toBe(false);
    mockUser = "user-1";
    expect(await listQueue("device_readings", "ble")).toHaveLength(2);
  });

  it("when the store cannot be opened, an old unmoved list is still listed and removable, never shown as empty", async () => {
    await AsyncStorage.setItem(DEVICE, legacyList(3));
    jest.spyOn(sqliteMock, "openDatabaseAsync").mockRejectedValue(new Error("database is locked")); // transient: busy disk
    const entries = await listQueue("device_readings", "ble");
    expect(entries).toHaveLength(3);
    await removeFromQueueStore("device_readings", entries[0].id, "ble");
    expect(await listQueue("device_readings", "ble")).toHaveLength(2);
    expect(await appendQueue("device_readings", { n: 9 }, "ble")).toBe(false); // says so; nothing written in clear
  });

  it("a held migration still counts its unmoved entries for the wipe, as unclaimed", async () => {
    await AsyncStorage.setItem(DEVICE, legacyList(6));
    const real = rules.rowsChecksum;
    let calls = 0;
    jest.spyOn(rules, "rowsChecksum").mockImplementation((rows, seed) => (++calls === 2 ? "deadbeef" : real(rows, seed)));
    expect(await countQueuedByOwner()).toEqual([{ owner: "", total: 6 }]);
  });

  it("an entry with a null item is kept as unreadable, so it can never block the head of a flush", async () => {
    await AsyncStorage.setItem(DEVICE, JSON.stringify([{ id: "x", enqueuedAt: "2026-10-01T00:00:00Z", item: null }, ...JSON.parse(legacyList(1))]));
    expect(await listQueue("device_readings", "ble")).toHaveLength(1);
    expect(await rowCount()).toBe(2);
  });

  it("trims by insertion order, so a phone clock that went backwards cannot delete the newest reading", async () => {
    const db = await getStore();
    await listQueue("device_readings", "ble");
    for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
      await db.runAsync(
        "insert into offline_queue_v1 (queue, owner_user_id, id, enqueued_at, payload) values ('device_readings', 'user-1', ?, '2026-12-31T00:00:00.000Z', ?)",
        [`s${i}`, JSON.stringify({ i })]
      );
    }
    expect(await appendQueue("device_readings", { i: "new" }, "ble")).toBe(true); // clock now earlier than every queued row
    const list = await listQueue<{ i: number | string }>("device_readings", "ble");
    expect(list).toHaveLength(MAX_QUEUE_SIZE);
    expect(list[MAX_QUEUE_SIZE - 1].item.i).toBe("new");
  });

  it("still queues when S06x had to use its plain file (no SQLCipher), and nothing is lost on the way", async () => {
    __setCipherAvailable(false);
    await AsyncStorage.setItem(DEVICE, legacyList(4));
    expect(await listQueue("device_readings", "ble")).toHaveLength(4);
    expect(await appendQueue("device_readings", { n: 5 }, "ble")).toBe(true);
    expect(await listQueue("device_readings", "ble")).toHaveLength(5);
    __setCipherAvailable(true);
  });
});

describe("accounts and sign-out", () => {
  it("scopes every read to the signed-in account; signing out hides but does not delete", async () => {
    await appendQueue("device_readings", { who: 1 }, "ble");
    mockUser = "user-2";
    await appendQueue("device_readings", { who: 2 }, "ble");
    expect((await listQueue<{ who: number }>("device_readings", "ble")).map((e) => e.item.who)).toEqual([2]);
    mockUser = null;
    expect(await listQueue("device_readings", "ble")).toEqual([]);
    expect(await appendQueue("device_readings", { who: 3 }, "ble")).toBe(false);
    expect(await countQueuedByOwner()).toEqual(expect.arrayContaining([{ owner: "user-1", total: 1 }, { owner: "user-2", total: 1 }]));
    mockUser = "user-1";
    expect((await listQueue<{ who: number }>("device_readings", "ble")).map((e) => e.item.who)).toEqual([1]);
    // Another account cannot remove it either.
    mockUser = "user-2";
    const id = (await listQueue("device_readings", "ble"))[0].id;
    mockUser = "user-1";
    await removeFromQueueStore("device_readings", id, "ble");
    expect(await listQueue("device_readings", "ble")).toHaveLength(1);
  });

  it("keeps the newest MAX_QUEUE_SIZE per account and queue, and the other account's queue is untouched", async () => {
    mockUser = "user-2";
    await appendQueue("device_readings", { keep: true }, "ble");
    mockUser = "user-1";
    const db = await getStore();
    await listQueue("device_readings", "ble");
    for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
      await db.runAsync(
        "insert into offline_queue_v1 (queue, owner_user_id, id, enqueued_at, payload) values ('device_readings', 'user-1', ?, ?, ?)",
        [`s${i}`, new Date(Date.UTC(2026, 0, 1) + i).toISOString(), JSON.stringify({ i })]
      );
    }
    expect(await appendQueue("device_readings", { i: "new" }, "ble")).toBe(true);
    const list = await listQueue<{ i: number | string }>("device_readings", "ble");
    expect(list).toHaveLength(MAX_QUEUE_SIZE);
    expect(list[0].item.i).toBe(1);
    expect(list[MAX_QUEUE_SIZE - 1].item.i).toBe("new");
    mockUser = "user-2";
    expect(await listQueue("device_readings", "ble")).toHaveLength(1);
  });
});

describe("remote wipe", () => {
  it("destroyStore removes the file that holds the queues; a fresh start has none", async () => {
    await appendQueue("device_readings", { n: 1 }, "ble");
    expect(__databaseNames().some((n) => n.startsWith("tarragon-secure-"))).toBe(true);
    await destroyStore();
    expect(__databaseNames().filter((n) => n.startsWith("tarragon-secure-"))).toEqual([]);
    expect(await listQueue("device_readings", "ble")).toEqual([]);
  });
});
