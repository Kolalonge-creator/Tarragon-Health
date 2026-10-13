/**
 * S06x remote wipe and key lease (decision D3, refined for urgent entries): one last upload attempt, then the store,
 * the key and every other local copy are removed, each account is told in the app and the server gets COUNTS. A lease
 * is judged on the server's clock and never wipes while an urgent entry is unsent. Never silent.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { __databaseNames } from "../test/mocks/expo-sqlite";
import { __resetDeviceCheckThrottle, runDeviceCheck, runDeviceCheckThrottled } from "./device-lease";
import { getStore } from "./secure-db";
import { getOrCreateDeviceId, listDeviceAccounts } from "./store-key";
import { listStoreNotices, noticesFor } from "./store-notices";

const calls: string[] = [];
let mockUser: string | null = "user-1";
type RpcAnswer = { data: unknown; error: { code?: string; message: string } | null };
const LEASE_OK: RpcAnswer = { data: { revoked: false, lease_expires_at: "2026-11-12T12:00:00Z", lease_days: 30, server_now: "2026-10-13T12:00:00Z", prev_lease_expires_at: null }, error: null };
let mockCheckin: RpcAnswer = LEASE_OK;
let mockConfirm: { error: { code?: string; message: string } | null } = { error: null };
const mockConfirmArgs: { p_device: string; p_unsent: number; p_danger: number; p_reason: string }[] = [];
let mockOwners: { owner: string; total: number; danger: number }[] = [{ owner: "user-1", total: 3, danger: 0 }];
let mockFlushThrows = false;

jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }),
      signOut: async () => {
        calls.push("signOut");
        mockUser = null;
        return { error: null };
      },
    },
    rpc: async (name: string, args: never) => {
      calls.push(`rpc:${name}`);
      if (name === "offline_device_checkin") return mockCheckin;
      mockConfirmArgs.push(args);
      return mockConfirm;
    },
  },
}));
jest.mock("./outbox", () => ({
  flushOutbox: async () => {
    calls.push("flush");
    if (mockFlushThrows) throw new Error("Network request failed");
    return { synced: 0, remaining: 0, stoppedOffline: true, held: 0, newlyRejected: 0 };
  },
  countUnsentByOwner: async () => {
    calls.push("count");
    return mockOwners;
  },
  countDangerUnsent: async () => mockOwners.reduce((n, o) => n + o.danger, 0),
}));

const NOW = new Date("2026-10-13T12:00:00Z");
const LEASE_KEY = "@tarragon/device-lease/v1";
const PENDING_KEY = "@tarragon/device-wipe-confirm/v1";
const REVOKED: RpcAnswer = { data: { revoked: true, wipe_reason: "stolen" }, error: null };
const OFFLINE: RpcAnswer = { data: null, error: { message: "Network request failed" } };

beforeEach(() => {
  calls.length = 0;
  mockConfirmArgs.length = 0;
  mockUser = "user-1";
  mockCheckin = LEASE_OK;
  mockConfirm = { error: null };
  mockOwners = [{ owner: "user-1", total: 3, danger: 0 }];
  mockFlushThrows = false;
  __resetDeviceCheckThrottle();
});

async function seedPhone(): Promise<void> {
  const db = await getStore();
  await db.execAsync("create table if not exists t (a text)");
  await AsyncStorage.setItem("@tarragon/offline-queue/device-readings/v1", '[{"systolic":150}]');
  await AsyncStorage.setItem("@tarragon/reminders/prefs", "x");
}
const phoneIsGone = () => __databaseNames().filter((n) => n.startsWith("tarragon-"));
const state = async () => JSON.parse((await AsyncStorage.getItem(LEASE_KEY)) ?? "{}");

describe("check-in", () => {
  it("registers the phone and remembers the lease the server gave", async () => {
    expect(await runDeviceCheck(NOW)).toBe("ok");
    expect(await state()).toMatchObject({ leaseExpiresAt: "2026-11-12T12:00:00Z", userId: "user-1", leaseDays: 30 });
    expect(await SecureStore.getItemAsync("tarragon.offline.device.id.v1.user-1")).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(await listDeviceAccounts())).toEqual(["user-1"]);
  });

  it("does nothing with nobody signed in and no lease on record", async () => {
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
    expect(phoneIsGone().length).toBeGreaterThan(0);
  });
});

describe("a lost-phone report", () => {
  it("makes one last upload attempt, then wipes the store, the key and the other local copies, and tells the patient", async () => {
    await seedPhone();
    await runDeviceCheck(NOW);
    calls.length = 0;
    mockCheckin = REVOKED;
    expect(await runDeviceCheck(NOW)).toBe("wiped");

    expect(calls.indexOf("flush")).toBeLessThan(calls.indexOf("count"));
    expect(calls.indexOf("count")).toBeLessThan(calls.indexOf("rpc:confirm_offline_device_wipe"));
    expect(calls.indexOf("rpc:confirm_offline_device_wipe")).toBeLessThan(calls.indexOf("signOut")); // the server needs the session
    expect(phoneIsGone()).toEqual([]);
    expect(await SecureStore.getItemAsync("tarragon.offline.store.key.v1")).toBeNull();
    expect(await AsyncStorage.getItem("@tarragon/offline-queue/device-readings/v1")).toBeNull();
    expect(await AsyncStorage.getItem("@tarragon/reminders/prefs")).toBeNull();
    expect((await listStoreNotices())[0]).toMatchObject({ kind: "wiped", reason: "stolen", unsent: 3, ownerUserId: "user-1" });
    expect(mockConfirmArgs).toEqual([{ p_device: expect.stringMatching(/^[0-9a-f-]{36}$/), p_unsent: 3, p_danger: 0, p_reason: "stolen" }]);
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("wipes an urgent entry too (an explicit report is the one thing that does), and reports the urgent COUNT", async () => {
    mockOwners = [{ owner: "user-1", total: 2, danger: 1 }];
    mockCheckin = REVOKED;
    expect(await runDeviceCheck(NOW)).toBe("wiped");
    expect(mockConfirmArgs[0]).toMatchObject({ p_unsent: 2, p_danger: 1 });
  });

  it("every account on the phone gets its own notice and its own confirmation, delivered when THAT account signs in", async () => {
    await runDeviceCheck(NOW); // user-1 registers
    mockUser = "user-2";
    await runDeviceCheck(NOW); // user-2 registers
    mockUser = "user-1";
    mockOwners = [
      { owner: "user-1", total: 2, danger: 1 },
      { owner: "user-2", total: 5, danger: 0 },
    ];
    calls.length = 0;
    mockCheckin = REVOKED;
    await runDeviceCheck(NOW);

    const notices = await listStoreNotices();
    expect(notices.filter((n) => n.kind === "wiped").map((n) => (n.kind === "wiped" ? [n.ownerUserId, n.unsent] : null)).sort()).toEqual([
      ["user-1", 2],
      ["user-2", 5],
    ]);
    // each account only sees its own number
    expect(noticesFor(notices, "user-1")).toHaveLength(1);
    expect(noticesFor(notices, "user-2")).toHaveLength(1);
    expect(mockConfirmArgs.map((a) => a.p_unsent)).toEqual([2]); // user-1 told now
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? "[]")).toMatchObject([{ userId: "user-2", unsent: 5, reason: "shared_phone" }]);

    // user-2 signs in later: their confirmation is delivered, with the shared-phone reason
    mockUser = "user-2";
    mockCheckin = LEASE_OK;
    await runDeviceCheck(NOW);
    expect(mockConfirmArgs.at(-1)).toMatchObject({ p_unsent: 5, p_reason: "shared_phone" });
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("resets the device id of EVERY account known on the phone, and works with nobody signed in", async () => {
    await runDeviceCheck(NOW);
    mockUser = "user-2";
    await runDeviceCheck(NOW);
    expect(await SecureStore.getItemAsync("tarragon.offline.device.id.v1.user-2")).not.toBeNull();
    mockUser = "user-1";
    mockCheckin = REVOKED;
    await runDeviceCheck(NOW);
    expect(await SecureStore.getItemAsync("tarragon.offline.device.id.v1.user-1")).toBeNull();
    expect(await SecureStore.getItemAsync("tarragon.offline.device.id.v1.user-2")).toBeNull();
    expect(await listDeviceAccounts()).toEqual({});
    // later registrations get new ids
    mockCheckin = LEASE_OK;
    mockUser = "user-1";
    expect(await getOrCreateDeviceId("user-1")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("still wipes when the last upload attempt throws", async () => {
    mockFlushThrows = true;
    await seedPhone();
    mockCheckin = REVOKED;
    expect(await runDeviceCheck(NOW)).toBe("wiped");
    expect((await listStoreNotices())[0]).toMatchObject({ kind: "wiped", unsent: 3 });
    expect(phoneIsGone()).toEqual([]);
  });

  it("keeps a confirmation the server refused, and delivers it later", async () => {
    mockConfirm = { error: { message: "Network request failed" } };
    mockCheckin = REVOKED;
    await runDeviceCheck(NOW);
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? "[]")).toHaveLength(1);
    mockUser = "user-1";
    mockConfirm = { error: null };
    mockCheckin = LEASE_OK;
    await runDeviceCheck(NOW);
    expect(await AsyncStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("keeps the confirmation when nobody is signed in, and does not drop it on a 42501", async () => {
    mockCheckin = REVOKED;
    mockConfirm = { error: { code: "42501", message: "not allowed" } };
    await runDeviceCheck(NOW);
    expect(await AsyncStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it("the notices carry no health value", async () => {
    mockCheckin = REVOKED;
    await runDeviceCheck(NOW);
    const [notice] = await listStoreNotices();
    expect(Object.keys(notice).sort()).toEqual(["at", "id", "kind", "ownerUserId", "reason", "unsent"]);
  });
});

describe("the key lease", () => {
  async function leaseGranted(): Promise<void> {
    await runDeviceCheck(NOW); // lease to 2026-11-12T12:00
    calls.length = 0;
  }

  it("wipes when the SERVER says the lease it held had lapsed, after one last upload attempt", async () => {
    await seedPhone();
    await leaseGranted();
    mockCheckin = { data: { revoked: false, lease_expires_at: "2026-12-20T00:00:00Z", lease_days: 30, server_now: "2026-11-20T00:00:00Z", prev_lease_expires_at: "2026-11-12T12:00:00Z" }, error: null };
    expect(await runDeviceCheck(new Date("2026-11-20T00:00:00Z"))).toBe("wiped");
    expect(calls.indexOf("flush")).toBeGreaterThan(-1);
    expect(calls).toContain("signOut");
    expect((await listStoreNotices())[0]).toMatchObject({ kind: "wiped", reason: "lease_expired", days: 30 });
    expect(phoneIsGone()).toEqual([]);
  });

  it("does NOT wipe a phone whose own clock jumped forward when the server says the lease is fine, and renews it", async () => {
    await seedPhone();
    await leaseGranted();
    mockCheckin = { data: { revoked: false, lease_expires_at: "2026-11-20T00:00:00Z", lease_days: 30, server_now: "2026-10-21T00:00:00Z", prev_lease_expires_at: "2026-11-12T12:00:00Z" }, error: null };
    expect(await runDeviceCheck(new Date("2027-03-01T00:00:00Z"))).toBe("ok"); // the phone thinks it is March
    expect(phoneIsGone().length).toBeGreaterThan(0);
    expect(await state()).toMatchObject({ leaseExpiresAt: "2026-11-20T00:00:00Z" });
    expect((await state()).expiredObservedAt).toBeUndefined();
  });

  it("names the lease length the server gave, not a bundled number", async () => {
    mockCheckin = { data: { revoked: false, lease_expires_at: "2026-10-27T12:00:00Z", lease_days: 14, server_now: NOW.toISOString(), prev_lease_expires_at: null }, error: null };
    await runDeviceCheck(NOW);
    mockCheckin = { data: { revoked: false, lease_expires_at: "2026-11-11T00:00:00Z", lease_days: 14, server_now: "2026-10-28T00:00:00Z", prev_lease_expires_at: "2026-10-27T12:00:00Z" }, error: null };
    await runDeviceCheck(new Date("2026-10-28T00:00:00Z"));
    expect((await listStoreNotices())[0]).toMatchObject({ kind: "wiped", reason: "lease_expired", days: 14 });
  });

  describe("offline (the server cannot confirm)", () => {
    it("the phone's own record only STARTS a grace period; the wipe waits until it has run", async () => {
      await seedPhone();
      await leaseGranted();
      mockCheckin = OFFLINE;
      const lapsed = new Date("2026-11-13T00:00:00Z");
      expect(await runDeviceCheck(lapsed)).toBe("offline");
      expect((await state()).expiredObservedAt).toBe(lapsed.toISOString());
      expect(phoneIsGone().length).toBeGreaterThan(0);
      expect(await runDeviceCheck(new Date("2026-11-13T23:00:00Z"))).toBe("offline"); // 23 hours: not yet
      expect(phoneIsGone().length).toBeGreaterThan(0);
      expect(calls).not.toContain("flush");

      expect(await runDeviceCheck(new Date("2026-11-14T00:00:00Z"))).toBe("wiped"); // 24 hours
      expect(calls[0]).toBe("rpc:offline_device_checkin");
      expect(calls).toContain("flush");
      expect((await listStoreNotices())[0]).toMatchObject({ kind: "wiped", reason: "lease_expired" });
      expect(phoneIsGone()).toEqual([]);
    });

    it("a forward clock jump that the server later corrects never wipes: reaching the server clears the grace period", async () => {
      await seedPhone();
      await leaseGranted();
      mockCheckin = OFFLINE;
      await runDeviceCheck(new Date("2027-03-01T00:00:00Z")); // clock jumped; grace starts
      mockCheckin = { data: { revoked: false, lease_expires_at: "2026-11-12T12:00:00Z", lease_days: 30, server_now: "2026-10-13T13:00:00Z", prev_lease_expires_at: "2026-11-12T12:00:00Z" }, error: null };
      expect(await runDeviceCheck(new Date("2027-03-02T12:00:00Z"))).toBe("ok");
      expect((await state()).expiredObservedAt).toBeUndefined();
      expect(phoneIsGone().length).toBeGreaterThan(0);
    });

    it("does nothing while the lease is still good, however long the phone has been offline", async () => {
      await seedPhone();
      await leaseGranted();
      mockCheckin = OFFLINE;
      expect(await runDeviceCheck(new Date("2026-11-11T00:00:00Z"))).toBe("offline");
      expect(await listStoreNotices()).toEqual([]);
    });

    it("never wipes a phone whose clock went backwards", async () => {
      await seedPhone();
      await leaseGranted();
      mockCheckin = OFFLINE;
      expect(await runDeviceCheck(new Date("2026-01-01T00:00:00Z"))).toBe("offline");
      expect((await state()).expiredObservedAt).toBeUndefined();
    });

    it("a clock that went backwards after the grace started cannot trigger it", async () => {
      await seedPhone();
      await leaseGranted();
      mockCheckin = OFFLINE;
      await runDeviceCheck(new Date("2026-11-13T00:00:00Z"));
      expect(await runDeviceCheck(new Date("2026-11-12T13:00:00Z"))).toBe("offline");
      expect(phoneIsGone().length).toBeGreaterThan(0);
    });

    it("never wipes a phone that has not checked in yet (no lease on record)", async () => {
      await seedPhone();
      mockCheckin = OFFLINE;
      expect(await runDeviceCheck(new Date("2030-01-01T00:00:00Z"))).toBe("offline");
      expect(phoneIsGone().length).toBeGreaterThan(0);
    });

    it("an outage on our side (5xx) neither wipes nor renews, and does not start the grace period", async () => {
      await seedPhone();
      await leaseGranted();
      mockCheckin = { data: null, error: { code: "PGRST000", message: "Service unavailable", status: 503 } as never };
      expect(await runDeviceCheck(new Date("2026-12-01T00:00:00Z"))).toBe("offline");
      expect((await state()).expiredObservedAt).toBeUndefined();
      expect(phoneIsGone().length).toBeGreaterThan(0);
    });

    it("a phone over its cap of registered phones (53400) is NOT skipped: its own lease record still applies", async () => {
      await seedPhone();
      await leaseGranted();
      mockCheckin = { data: null, error: { code: "53400", message: "too many registered phones" } };
      expect(await runDeviceCheck(new Date("2026-11-13T00:00:00Z"))).toBe("offline");
      expect((await state()).expiredObservedAt).toBeDefined(); // the grace period started
      expect(await runDeviceCheck(new Date("2026-11-14T01:00:00Z"))).toBe("wiped");
    });

    it("signed out, the phone's own lease record still applies", async () => {
      await seedPhone();
      await leaseGranted();
      mockUser = null;
      await runDeviceCheck(new Date("2026-11-13T00:00:00Z"));
      expect(await runDeviceCheck(new Date("2026-11-14T01:00:00Z"))).toBe("wiped");
      expect(phoneIsGone()).toEqual([]);
      expect(await listDeviceAccounts()).toEqual({}); // ids reset with nobody signed in
    });
  });

  describe("urgent entries", () => {
    it("a lapsed lease never wipes while an urgent entry is unsent, for ANY account on the phone", async () => {
      await seedPhone();
      await leaseGranted();
      mockOwners = [
        { owner: "user-1", total: 1, danger: 0 },
        { owner: "user-2", total: 1, danger: 1 },
      ];
      mockCheckin = { data: { revoked: false, lease_expires_at: "2026-12-20T00:00:00Z", lease_days: 30, server_now: "2026-11-20T00:00:00Z", prev_lease_expires_at: "2026-11-12T12:00:00Z" }, error: null };
      expect(await runDeviceCheck(new Date("2026-11-20T00:00:00Z"))).toBe("held");
      expect(calls).toContain("flush"); // the last attempt still happens
      expect(phoneIsGone().length).toBeGreaterThan(0);
      expect(await listStoreNotices()).toEqual([]);
    });

    it("the same rule holds offline", async () => {
      await seedPhone();
      await leaseGranted();
      mockOwners = [{ owner: "user-1", total: 1, danger: 1 }];
      mockCheckin = OFFLINE;
      await runDeviceCheck(new Date("2026-11-13T00:00:00Z"));
      expect(await runDeviceCheck(new Date("2026-11-20T00:00:00Z"))).toBe("held");
      expect(phoneIsGone().length).toBeGreaterThan(0);
    });

    it("once the urgent entry has gone, the next check wipes", async () => {
      await seedPhone();
      await leaseGranted();
      mockOwners = [{ owner: "user-1", total: 1, danger: 1 }];
      mockCheckin = OFFLINE;
      await runDeviceCheck(new Date("2026-11-13T00:00:00Z"));
      expect(await runDeviceCheck(new Date("2026-11-20T00:00:00Z"))).toBe("held");
      mockOwners = [{ owner: "user-1", total: 0, danger: 0 }];
      expect(await runDeviceCheck(new Date("2026-11-21T00:00:00Z"))).toBe("wiped");
    });
  });
});
