import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import * as storage from "../test/mocks/async-storage";
import { listStoreNotices } from "./store-notices";
import { mergeQueueJson, sealKvForWipe, secureKvGet, secureKvRemove, secureKvSet, secureKvUpdate, unsealKv } from "./secure-kv";
import { readCachedBpTarget } from "./bp-target";
import { readPendingRecheck } from "./triage-device";

jest.mock("./supabase", () => ({ supabase: {} }));

afterEach(() => {
  jest.restoreAllMocks();
});

describe("secureKv", () => {
  it("stores in the encrypted store and leaves nothing in plaintext AsyncStorage", async () => {
    await expect(secureKvSet("k", "v1")).resolves.toBe(true);
    expect(await secureKvGet("k")).toBe("v1");
    expect(await AsyncStorage.getItem("k")).toBeNull();
  });

  it("moves a plaintext value across, verified, then removes the plaintext copy", async () => {
    storage.__seedRaw("k", "old");
    expect(await secureKvGet("k")).toBe("old");
    expect(await AsyncStorage.getItem("k")).toBeNull();
    expect(await secureKvGet("k")).toBe("old");
  });

  it("a newer write replaces the value and a stale plaintext copy cannot come back", async () => {
    storage.__seedRaw("k", "old");
    await secureKvSet("k", "new");
    expect(await AsyncStorage.getItem("k")).toBeNull();
    expect(await secureKvGet("k")).toBe("new");
  });

  it("keeps the plaintext copy and still returns the value when the store is unavailable", async () => {
    storage.__seedRaw("k", "old");
    jest.spyOn(SQLite, "openDatabaseAsync").mockRejectedValue(new Error("cannot open"));
    expect(await secureKvGet("k")).toBe("old");
    expect(await AsyncStorage.getItem("k")).toBe("old");
  });

  it("falls back to a side copy in AsyncStorage for a write when the store is unavailable, and reports false only if that fails too", async () => {
    jest.spyOn(SQLite, "openDatabaseAsync").mockRejectedValue(new Error("cannot open"));
    await expect(secureKvSet("k", "v")).resolves.toBe(true);
    expect(await AsyncStorage.getItem("k#fb")).toBe("v");
    storage.__failNextSet();
    await expect(secureKvSet("k2", "v")).resolves.toBe(false);
  });

  it("a value written to the side copy while the store was down is moved into the store (and wins over an older stored value) once it works", async () => {
    await secureKvSet("k", "older");
    jest.spyOn(SQLite, "openDatabaseAsync").mockRejectedValue(new Error("cannot open"));
    await secureKvSet("k", "newer");
    jest.restoreAllMocks();
    expect(await secureKvGet("k")).toBe("newer");
    expect(await AsyncStorage.getItem("k#fb")).toBeNull();
  });

  it("never replaces a good encrypted row after a failed read: the write goes to the side copy and a queue keeps every entry", async () => {
    const e = (id: string, at: string) => ({ id, enqueuedAt: at, item: 1 });
    await secureKvSet("q", JSON.stringify([e("a", "2026-10-01T00:00:00Z"), e("b", "2026-10-02T00:00:00Z")]), mergeQueueJson);
    const spy = jest.spyOn(SQLite, "openDatabaseAsync").mockRejectedValueOnce(new Error("busy"));
    // The read fails (store unreadable), so the caller sees no entries and appends one...
    const during = await secureKvUpdate("q", mergeQueueJson, (raw) => JSON.stringify([...(raw ? JSON.parse(raw) : []), e("c", "2026-10-03T00:00:00Z")]));
    expect(during).toBe(true);
    spy.mockRestore();
    // ...and the next good read finds all three, not just the new one.
    const ids = (JSON.parse((await secureKvGet("q", mergeQueueJson)) ?? "[]") as { id: string }[]).map((x) => x.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("does not remove a plaintext copy it could not read (a timeout is unknown, not empty)", async () => {
    storage.__seedRaw("k", "old-queue");
    const real = AsyncStorage.getItem;
    jest.spyOn(AsyncStorage, "getItem").mockImplementation((name: string) => (name === "k" ? new Promise(() => {}) : real(name)));
    jest.useFakeTimers();
    const pending = secureKvSet("k", "new");
    await jest.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(true);
    jest.useRealTimers();
    jest.restoreAllMocks();
    expect(await AsyncStorage.getItem("k")).toBe("old-queue");
  });

  it("concurrent updates of one key all land (no lost update)", async () => {
    const add = (n: number) => secureKvUpdate("q", mergeQueueJson, (raw) => JSON.stringify([...(raw ? JSON.parse(raw) : []), { id: `x${n}`, enqueuedAt: `2026-10-0${n}T00:00:00Z`, item: n }]));
    await Promise.all([add(1), add(2), add(3), add(4), add(5)]);
    expect((JSON.parse((await secureKvGet("q", mergeQueueJson)) ?? "[]") as unknown[]).length).toBe(5);
  });

  it("a removal that the encrypted delete could not make leaves a tombstone, so the value does not come back", async () => {
    await secureKvSet("k", "v");
    jest.spyOn(SQLite, "openDatabaseAsync").mockRejectedValue(new Error("cannot open"));
    await secureKvRemove("k");
    jest.restoreAllMocks();
    expect(await secureKvGet("k")).toBeNull();
    expect(await AsyncStorage.getItem("k#fb")).toBeNull();
  });

  it("tells the patient once that a value had to go to plaintext storage", async () => {
    jest.spyOn(SQLite, "openDatabaseAsync").mockRejectedValue(new Error("cannot open"));
    await secureKvSet("k", "v1");
    await secureKvSet("k", "v2");
    const notices = (await listStoreNotices()).filter((n) => n.kind === "not_encrypted");
    expect(notices).toHaveLength(1);
  });

  it("once sealed for a wipe it writes, updates and removes nothing, and reads nothing, until it is unsealed", async () => {
    await secureKvSet("k", "v");
    sealKvForWipe();
    expect(await secureKvSet("k", "late")).toBe(false);
    expect(await secureKvUpdate("k", undefined, () => "late")).toBe(false);
    expect(await secureKvGet("k")).toBeNull();
    expect(await AsyncStorage.getItem("k#fb")).toBeNull();
    unsealKv();
    expect(await secureKvGet("k")).toBe("v");
  });

  it("remove clears both homes", async () => {
    await secureKvSet("k", "v");
    storage.__seedRaw("k", "stale");
    await secureKvRemove("k");
    expect(await secureKvGet("k")).toBeNull();
    expect(await AsyncStorage.getItem("k")).toBeNull();
  });

  it("serialises operations on one key, so a migration and a write cannot interleave", async () => {
    storage.__seedRaw("k", "old");
    const [a, b] = await Promise.all([secureKvGet("k"), secureKvSet("k", "new")]);
    expect(a).toBe("old");
    expect(b).toBe(true);
    expect(await secureKvGet("k")).toBe("new");
  });
});

describe("mergeQueueJson", () => {
  it("keeps entries from both sides, once each, oldest first", () => {
    const store = JSON.stringify([{ id: "b", enqueuedAt: "2026-10-02T00:00:00Z" }]);
    const legacy = JSON.stringify([
      { id: "a", enqueuedAt: "2026-10-01T00:00:00Z" },
      { id: "b", enqueuedAt: "2026-10-02T00:00:00Z" },
    ]);
    expect((JSON.parse(mergeQueueJson(store, legacy)) as { id: string }[]).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("treats an unreadable side as empty rather than throwing", () => {
    expect(JSON.parse(mergeQueueJson("not json", JSON.stringify([{ id: "a", enqueuedAt: "x" }])))).toHaveLength(1);
  });
});

describe("other values moved off plaintext AsyncStorage", () => {
  it("the remembered BP target is read from an older plaintext copy and then lives encrypted", async () => {
    const key = "@tarragon/bp-target/v1:u1:p1";
    storage.__seedRaw(key, JSON.stringify({ target: { systolicBelow: 130, diastolicBelow: 80, setBy: null, setAt: null } }));
    expect((await readCachedBpTarget("u1", "p1"))?.systolicBelow).toBe(130);
    expect(await AsyncStorage.getItem(key)).toBeNull();
    expect((await readCachedBpTarget("u1", "p1"))?.diastolicBelow).toBe(80);
  });

  it("a pending recheck written by an older build is still found after the move", async () => {
    const key = "@tarragon/triage/pending-recheck/v1:u1";
    const reading = { systolic: 170, diastolic: 100, takenAt: "2026-10-05T10:00:00.000Z" };
    storage.__seedRaw(key, JSON.stringify({ reading }));
    expect((await readPendingRecheck("u1"))?.reading.systolic).toBe(170);
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });
});
