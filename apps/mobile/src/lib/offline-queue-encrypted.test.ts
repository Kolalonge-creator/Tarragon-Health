/**
 * S06y: the device-reading, photo-reading and health-sample queues live in the ENCRYPTED store, not in AsyncStorage.
 * An older build's plaintext copy is moved across (oldest first) and then removed; the remote wipe takes the queues with the store.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { __resetStoreForTests, destroyStore, getStore } from "./secure-db";
import {
  enqueueDeviceReading,
  enqueueHealthSamplesPage,
  enqueuePhotoReading,
  listPendingDeviceReadings,
  listPendingHealthSamplesPages,
  listPendingPhotoReadings,
} from "./offline-queue";
import * as api from "./api";
import type { PhotoReadingRequest } from "./api";
import { flushDeviceReadingsQueue, getPendingCount } from "./offline-queue";
import { getRecentSyncDiagnostics } from "./sync-diagnostics";
import * as SQLite from "expo-sqlite";

jest.mock("./api", () => ({
  postDeviceReading: jest.fn(),
  postHealthSamples: jest.fn(),
  postPhotoReading: jest.fn(),
}));

const DEVICE_KEY = "@tarragon/offline-queue/device-readings/v1";
const HEALTH_KEY = "@tarragon/offline-queue/health-samples/v1";
const PHOTO_KEY = "@tarragon/offline-queue/photo-readings/v1";
const ALL_KEYS = [DEVICE_KEY, HEALTH_KEY, PHOTO_KEY];

const photo = { client_reading_id: "p1", systolic: 150 } as unknown as PhotoReadingRequest;

async function plaintextKeys(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter((k) => ALL_KEYS.includes(k));
}

describe("new entries go to the encrypted store only", () => {
  it("writes no queue entry to AsyncStorage", async () => {
    await enqueueDeviceReading({ systolic: 151 });
    await enqueueHealthSamplesPage({ provider: "apple_health", samples: [] });
    await enqueuePhotoReading(photo);
    expect(await plaintextKeys()).toEqual([]);
    const db = await getStore();
    const rows = await db.getAllAsync<{ queue: string }>("select queue from offline_queue order by seq");
    expect(rows.map((r) => r.queue)).toEqual([DEVICE_KEY, HEALTH_KEY, PHOTO_KEY]);
  });
});

describe("moving an older build's plaintext copy", () => {
  const entry = (id: string, n: number) => ({ id, enqueuedAt: `2026-10-0${n}T00:00:00.000Z`, item: { seq: n } });

  it("moves each queue across oldest first, ahead of anything new, then removes the plaintext", async () => {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([entry("a", 1), entry("b", 2)]));
    await AsyncStorage.setItem(HEALTH_KEY, JSON.stringify([{ id: "h", enqueuedAt: "2026-10-01T00:00:00.000Z", item: { provider: "apple_health", samples: [] } }]));
    await AsyncStorage.setItem(PHOTO_KEY, JSON.stringify([{ id: "x", enqueuedAt: "2026-10-01T00:00:00.000Z", item: photo }]));

    await enqueueDeviceReading({ seq: 3 });

    expect((await listPendingDeviceReadings()).map((e) => e.item)).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
    expect((await listPendingHealthSamplesPages()).map((e) => e.id)).toEqual(["h"]);
    expect((await listPendingPhotoReadings()).map((e) => e.id)).toEqual(["x"]);
    expect(await plaintextKeys()).toEqual([]);
  });

  it("moves the good entries and leaves the malformed ones in place (not ours to destroy)", async () => {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([entry("a", 1), { broken: true }, entry("c", 3)]));
    expect((await listPendingDeviceReadings()).map((e) => e.id)).toEqual(["a", "c"]);
    expect(JSON.parse((await AsyncStorage.getItem(DEVICE_KEY)) ?? "null")).toEqual([{ broken: true }]);
  });

  it("is safe to run twice: the same entries are not duplicated", async () => {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([entry("a", 1)]));
    await listPendingDeviceReadings();
    // A crash after the copy but before the key was removed leaves the plaintext behind; the next start copies again.
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([entry("a", 1)]));
    __resetStoreForTests();
    expect((await listPendingDeviceReadings()).map((e) => e.id)).toEqual(["a"]);
  });

  it("KEEPS the plaintext copy when the move into the encrypted table fails (nothing is lost)", async () => {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([entry("a", 1)]));
    const db = await getStore();
    await db.execAsync(
      "create table if not exists offline_queue (seq integer primary key, queue text not null, id text not null, enqueued_at text not null, item text not null, unique (queue, id));" +
        "create trigger refuse_insert before insert on offline_queue begin select raise(abort, 'disk full'); end;"
    );
    // a read never throws, and the entry is still visible from the plaintext copy while the move cannot complete
    expect((await listPendingDeviceReadings()).map((e) => e.id)).toEqual(["a"]);
    expect(await AsyncStorage.getItem(DEVICE_KEY)).not.toBeNull();
    await db.execAsync("drop trigger refuse_insert");
    // Once the store works again the next call moves it across.
    expect((await listPendingDeviceReadings()).map((e) => e.id)).toEqual(["a"]);
    expect(await AsyncStorage.getItem(DEVICE_KEY)).toBeNull();
  });

  it("leaves an unreadable plaintext value alone (it is not ours to destroy) and still serves the queue", async () => {
    await AsyncStorage.setItem(DEVICE_KEY, "[[[[");
    await expect(listPendingDeviceReadings()).resolves.toEqual([]);
    await enqueueDeviceReading({ seq: 1 });
    expect(await listPendingDeviceReadings()).toHaveLength(1);
    expect(await AsyncStorage.getItem(DEVICE_KEY)).toBe("[[[[");
  });
});

describe("the remote wipe covers the queues", () => {
  it("destroyStore removes every queued entry", async () => {
    await enqueueDeviceReading({ systolic: 151 });
    await enqueuePhotoReading(photo);
    await destroyStore();
    expect(await listPendingDeviceReadings()).toEqual([]);
    expect(await listPendingPhotoReadings()).toEqual([]);
  });
});

describe("overflow in the encrypted table", () => {
  it("drops the oldest, keeps the newest, per queue", async () => {
    for (let i = 0; i < 501; i++) await enqueueDeviceReading({ seq: i });
    await enqueuePhotoReading(photo);
    const device = await listPendingDeviceReadings();
    expect(device).toHaveLength(500);
    expect(device[0]?.item).toEqual({ seq: 1 });
    expect(await listPendingPhotoReadings()).toHaveLength(1);
  });
});

describe("concurrent flushes", () => {
  it("two callers at once send each entry once: the second waits, then finds the queue empty", async () => {
    await enqueueDeviceReading({ seq: 1 });
    await enqueueDeviceReading({ seq: 2 });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const post = api.postDeviceReading as jest.MockedFunction<typeof api.postDeviceReading>;
    post.mockImplementation(async () => {
      await gate;
      return { success: true };
    });
    const a = flushDeviceReadingsQueue();
    const b = flushDeviceReadingsQueue();
    release();
    await Promise.all([a, b]);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("when the encrypted store cannot be opened", () => {
  it("still counts and lists an older build's plaintext entries, so the reconnect trigger and flush keep working", async () => {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([{ id: "a", enqueuedAt: "2026-10-01T00:00:00.000Z", item: { seq: 1 } }]));
    const spy = jest.spyOn(SQLite, "openDatabaseAsync").mockRejectedValue(new Error("keystore down"));
    try {
      expect(await getPendingCount()).toBe(1);
      expect((await listPendingDeviceReadings()).map((e) => e.id)).toEqual(["a"]);
      // a new entry is reported as NOT saved rather than pretended
      await expect(enqueueDeviceReading({ seq: 2 })).resolves.toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("migration records what it leaves behind", () => {
  it("names the malformed entries it could not move", async () => {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([{ id: "a", enqueuedAt: "2026-10-01T00:00:00.000Z", item: {} }, { broken: true }, { alsoBroken: 1 }]));
    await listPendingDeviceReadings();
    expect(getRecentSyncDiagnostics().some((e) => e.detail === "offline_queue:migrate" && /2 malformed/.test(String(e.message)))).toBe(true);
  });
});

describe("a failing plaintext move never blocks saving", () => {
  const old = { id: "old", enqueuedAt: "2026-10-01T00:00:00.000Z", item: { seq: 0 } };

  it("saves the new entry into the encrypted table even when the move fails, shows both, and finishes the move on a later call", async () => {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([old]));
    const real = AsyncStorage.getItem.bind(AsyncStorage);
    const spy = jest.spyOn(AsyncStorage, "getItem").mockImplementation(async (k: string) => {
      if (k === DEVICE_KEY) throw new Error("storage read failed");
      return real(k);
    });
    try {
      await expect(enqueueDeviceReading({ seq: 1 })).resolves.toBe(true);
      const db = await getStore();
      const rows = await db.getAllAsync<{ id: string }>("select id from offline_queue where queue = ?", [DEVICE_KEY]);
      expect(rows).toHaveLength(1); // the new entry is in the encrypted table already
    } finally {
      spy.mockRestore();
    }
    // The move now works: old entry first (older enqueuedAt), new entry second, each once, plaintext gone.
    expect((await listPendingDeviceReadings()).map((e) => e.item)).toEqual([{ seq: 0 }, { seq: 1 }]);
    expect(await AsyncStorage.getItem(DEVICE_KEY)).toBeNull();
  });
});

describe("two JS contexts moving the same plaintext queue", () => {
  it("never puts back an entry the other context already moved, sent and deleted", async () => {
    const x = { id: "x", enqueuedAt: "2026-10-01T00:00:00.000Z", item: { seq: 1 } };
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([x]));
    expect((await listPendingDeviceReadings()).map((e) => e.id)).toEqual(["x"]);
    // The background task sends x and deletes it.
    const db = await getStore();
    await db.runAsync("delete from offline_queue where queue = ? and id = 'x'", [DEVICE_KEY]);
    // The app's context still holds the plaintext it read before the other one finished, and now writes its move.
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify([x]));
    __resetStoreForTests();
    expect(await listPendingDeviceReadings()).toEqual([]);
    expect(await AsyncStorage.getItem(DEVICE_KEY)).toBeNull();
  });
});
