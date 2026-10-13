/**
 * S06x remote wipe and key lease (decision D3): one last upload attempt, then the store, the key and
 * every other local copy are removed, the patient is told, the server gets a COUNT. Never silent.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { __databaseNames } from "../test/mocks/expo-sqlite";
import { __resetDeviceCheckThrottle, runDeviceCheck, runDeviceCheckThrottled, wipeThisPhone } from "./device-lease";
import { getStore } from "./secure-db";
import { listStoreNotices } from "./store-notices";

const calls: string[] = [];
let mockUser: string | null = "user-1";
let mockCheckin: { data: unknown; error: { code?: string; message: string } | null } = { data: { revoked: false, lease_expires_at: "2026-11-12T12:00:00Z" }, error: null };
let mockConfirm: { error: { code?: string; message: string } | null } = { error: null };
const confirmArgs: unknown[] = [];
let mockUnsent = 3;
let mockFlushThrows = false;

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }),
      signOut: async () => {
        calls.push("signOut");
        return { error: null };
      },
    },
    rpc: async (name: string, args: unknown) => {
      calls.push(`rpc:${name}`);
      if (name === "offline_device_checkin") return mockCheckin;
      confirmArgs.push(args);
      return mockConfirm;
    },
  },
}));
jest.mock("./outbox", () => ({
  flushOutbox: async () => {
    calls.push("flush");
    if (mockFlushThrows) throw new Error("Network request failed");
    return { synced: 0, remaining: mockUnsent, stoppedOffline: true, held: 0, newlyRejected: 0 };
  },
  countAllOutboxRows: async () => {
    calls.push("count");
    return mockUnsent;
  },
}));

const NOW = new Date("2026-10-13T12:00:00Z");

beforeEach(() => {
  calls.length = 0;
  confirmArgs.length = 0;
  mockUser = "user-1";
  mockCheckin = { data: { revoked: false, lease_expires_at: "2026-11-12T12:00:00Z" }, error: null };
  mockConfirm = { error: null };
  mockUnsent = 3;
  mockFlushThrows = false;
  __resetDeviceCheckThrottle();
});

async function seedPhone(): Promise<void> {
  const db = await getStore();
  await db.execAsync("create table if not exists t (a text)");
  await AsyncStorage.setItem("@tarragon/offline-queue/device-readings/v1", "[{\"systolic\":150}]");
  await AsyncStorage.setItem("@tarragon/reminders/prefs", "x");
}

describe("check-in", () => {
  it("registers the phone and remembers the lease the server gave", async () => {
    expect(await runDeviceCheck(NOW)).toBe("ok");
    expect(JSON.parse((await AsyncStorage.getItem("@tarragon/device-lease/v1")) ?? "{}")).toMatchObject({
      leaseExpiresAt: "2026-11-12T12:00:00Z",
      userId: "user-1",
    });
    expect(await SecureStore.getItemAsync("tarragon.offline.device.id.v1.user-1")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does nothing with nobody signed in", async () => {
    mockUser = null;
    expect(await runDeviceCheck(NOW)).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("is rate limited when called from the foreground loops", async () => {
    expect(await runDeviceCheckThrottled(1_000_000)).toBe("ok");
    expect(await runDeviceCheckThrottled(1_000_000 + 60_000)).toBe("skipped");
    expect(await runDeviceCheckThrottled(1_000_000 + 11 * 60_000)).toBe("ok");
  });

  it("a server error that is not an outage never wipes anything", async () => {
    await seedPhone();
    mockCheckin = { data: null, error: { code: "42501", message: "device belongs to another account" } };
    expect(await runDeviceCheck(NOW)).toBe("skipped");
    expect(__databaseNames().length).toBeGreaterThan(0);
  });
});

describe("a lost-phone report", () => {
  it("makes one last upload attempt, then wipes the store, the key and the other local copies, and tells the patient", async () => {
    await seedPhone();
    mockCheckin = { data: { revoked: true, wipe_reason: "stolen" }, error: null };
    expect(await runDeviceCheck(NOW)).toBe("wiped");

    // order: check-in, the last upload attempt, the count, and the confirmation after the wipe
    expect(calls[0]).toBe("rpc:offline_device_checkin");
    expect(calls.indexOf("flush")).toBeLessThan(calls.indexOf("count"));
    expect(calls.indexOf("count")).toBeLessThan(calls.indexOf("rpc:confirm_offline_device_wipe"));
    expect(calls).toContain("signOut"); // a lost phone must not stay signed in

    expect(__databaseNames().filter((n) => n.startsWith("tarragon-"))).toEqual([]);
    expect(await SecureStore.getItemAsync("tarragon.offline.store.key.v1")).toBeNull();
    expect(await AsyncStorage.getItem("@tarragon/offline-queue/device-readings/v1")).toBeNull();
    expect(await AsyncStorage.getItem("@tarragon/reminders/prefs")).toBeNull();

    const [notice] = await listStoreNotices();
    expect(notice).toMatchObject({ kind: "wiped", reason: "stolen", unsent: 3 });
    expect(confirmArgs).toEqual([{ p_device: expect.stringMatching(/^[0-9a-f-]{36}$/), p_unsent: 3 }]);
    expect(await AsyncStorage.getItem("@tarragon/device-wipe-confirm/v1")).toBeNull();
  });

  it("registers as a NEW phone afterwards, so the revoked id is not checked in again", async () => {
    mockCheckin = { data: { revoked: true, wipe_reason: "lost_phone" }, error: null };
    await runDeviceCheck(NOW);
    const first = confirmArgs[0] as { p_device: string };
    mockCheckin = { data: { revoked: false, lease_expires_at: "2026-11-12T12:00:00Z" }, error: null };
    await runDeviceCheck(NOW);
    const id = await SecureStore.getItemAsync("tarragon.offline.device.id.v1.user-1");
    expect(id).not.toBe(first.p_device);
  });

  it("still wipes when the last upload attempt throws, and still reports the count", async () => {
    mockFlushThrows = true;
    await seedPhone();
    mockCheckin = { data: { revoked: true }, error: null };
    expect(await runDeviceCheck(NOW)).toBe("wiped");
    expect((await listStoreNotices())[0]).toMatchObject({ kind: "wiped", unsent: 3 });
    expect(__databaseNames().filter((n) => n.startsWith("tarragon-"))).toEqual([]);
  });

  it("keeps the confirmation to send later when the server cannot be reached right after the wipe", async () => {
    mockConfirm = { error: { message: "Network request failed" } };
    mockCheckin = { data: { revoked: true }, error: null };
    await runDeviceCheck(NOW);
    expect(JSON.parse((await AsyncStorage.getItem("@tarragon/device-wipe-confirm/v1")) ?? "{}")).toMatchObject({ unsent: 3 });
    mockConfirm = { error: null };
    mockCheckin = { data: { revoked: false, lease_expires_at: "2026-11-12T12:00:00Z" }, error: null };
    await runDeviceCheck(NOW);
    expect(await AsyncStorage.getItem("@tarragon/device-wipe-confirm/v1")).toBeNull();
  });

  it("the notice outlives the wipe and carries no health value", async () => {
    await wipeThisPhone("admin", "dev-1", NOW);
    const [notice] = await listStoreNotices();
    expect(Object.keys(notice).sort()).toEqual(["at", "id", "kind", "reason", "unsent"]);
  });
});

describe("a key lease that ran out", () => {
  async function checkInOnce(): Promise<void> {
    await runDeviceCheck(NOW); // lease to 2026-11-12
    calls.length = 0;
    mockCheckin = { data: null, error: { message: "Network request failed" } };
  }

  it("wipes after the last upload attempt once 30 days have passed with no contact", async () => {
    await seedPhone();
    await checkInOnce();
    expect(await runDeviceCheck(new Date("2026-11-13T00:00:00Z"))).toBe("wiped");
    expect(calls.slice(0, 2)).toEqual(["rpc:offline_device_checkin", "flush"]);
    expect((await listStoreNotices())[0]).toMatchObject({ kind: "wiped", reason: "lease_expired" });
    expect(__databaseNames().filter((n) => n.startsWith("tarragon-"))).toEqual([]);
  });

  it("does nothing while the lease is still good, however long the phone has been offline", async () => {
    await seedPhone();
    await checkInOnce();
    expect(await runDeviceCheck(new Date("2026-11-11T00:00:00Z"))).toBe("offline");
    expect(__databaseNames().length).toBeGreaterThan(0);
    expect(await listStoreNotices()).toEqual([]);
  });

  it("an outage on our side (a 5xx) never runs the lease down", async () => {
    await seedPhone();
    await checkInOnce();
    mockCheckin = { data: null, error: { code: "PGRST000", message: "Service unavailable", status: 503 } as never };
    expect(await runDeviceCheck(new Date("2026-12-01T00:00:00Z"))).toBe("offline");
    expect(__databaseNames().length).toBeGreaterThan(0);
  });

  it("never wipes a phone whose clock went backwards", async () => {
    await seedPhone();
    await checkInOnce();
    expect(await runDeviceCheck(new Date("2026-01-01T00:00:00Z"))).toBe("offline");
  });

  it("never wipes a phone that has not checked in yet (no lease on record)", async () => {
    await seedPhone();
    mockCheckin = { data: null, error: { message: "Network request failed" } };
    expect(await runDeviceCheck(new Date("2030-01-01T00:00:00Z"))).toBe("offline");
    expect(__databaseNames().length).toBeGreaterThan(0);
  });
});
