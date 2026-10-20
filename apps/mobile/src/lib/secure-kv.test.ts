import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import * as storage from "../test/mocks/async-storage";
import { mergeQueueJson, secureKvGet, secureKvRemove, secureKvSet } from "./secure-kv";
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

  it("falls back to AsyncStorage for a write when the store is unavailable, and reports false only if that fails too", async () => {
    jest.spyOn(SQLite, "openDatabaseAsync").mockRejectedValue(new Error("cannot open"));
    await expect(secureKvSet("k", "v")).resolves.toBe(true);
    expect(await AsyncStorage.getItem("k")).toBe("v");
    storage.__failNextSet();
    await expect(secureKvSet("k2", "v")).resolves.toBe(false);
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
