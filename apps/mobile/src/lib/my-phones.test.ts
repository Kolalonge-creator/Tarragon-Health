/**
 * My phones on the phone (S06z): a failed read is a failure and never an empty list, this phone is marked, removing THIS phone makes one last
 * upload attempt before counting and then checks in at once, removing another phone only files the request, and a refused request changes nothing.
 */
import { lastTryAndCount, loadPhones, removePhone, savePhoneDetails } from "./my-phones";
import { supabase } from "./supabase";
import { flushOutbox, countUnsentByOwner } from "./outbox";
import { reportPhoneLost, runDeviceCheck } from "./device-lease";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock("./sync-diagnostics", () => ({ recordSyncError: jest.fn() }));
jest.mock("./outbox", () => ({ flushOutbox: jest.fn(), countUnsentByOwner: jest.fn() }));
jest.mock("./device-lease", () => ({ reportPhoneLost: jest.fn(), runDeviceCheck: jest.fn() }));
jest.mock("./store-key", () => ({ getOrCreateDeviceId: jest.fn().mockResolvedValue("dev-this") }));

const rpc = supabase.rpc as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;

const selectChain = (result: { data: unknown; error: unknown }) => ({
  select: () => ({ order: () => ({ limit: () => Promise.resolve(result) }) }),
});

const NOW = new Date("2026-10-20T10:00:00Z");
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  device_id: id,
  platform: "android",
  last_checkin_at: "2026-10-19T10:00:00Z",
  lease_expires_at: "2026-11-18T10:00:00Z",
  ...extra,
});

beforeEach(() => jest.clearAllMocks());

describe("loadPhones", () => {
  it("marks this phone and keeps the others", async () => {
    from.mockReturnValue(selectChain({ data: [row("dev-this"), row("dev-other", { device_label: "Old Tecno" })], error: null }));
    const r = await loadPhones("u1", NOW);
    expect(r.ok && r.phones.map((p) => [p.deviceId, p.isThisPhone, p.name])).toEqual([
      ["dev-this", true, "Android phone"],
      ["dev-other", false, "Old Tecno"],
    ]);
  });

  it("a failed read is a failure, not an empty list", async () => {
    from.mockReturnValue(selectChain({ data: null, error: { message: "boom" } }));
    expect(await loadPhones("u1", NOW)).toEqual({ ok: false });
  });

  it("counts rows it could not read", async () => {
    from.mockReturnValue(selectChain({ data: [row("a"), { nope: 1 }], error: null }));
    const r = await loadPhones("u1", NOW);
    expect(r.ok && r.dropped).toBe(1);
  });
});

describe("savePhoneDetails", () => {
  it("sends only what changed", async () => {
    rpc.mockResolvedValue({ error: null });
    await savePhoneDetails("d", { shared: true });
    expect(rpc).toHaveBeenCalledWith("update_my_offline_device", { p_device: "d", p_shared: true });
    await savePhoneDetails("d", { label: null });
    expect(rpc).toHaveBeenLastCalledWith("update_my_offline_device", { p_device: "d", p_clear_label: true });
  });
  it("reports a refusal, and a throw", async () => {
    rpc.mockResolvedValue({ error: { message: "no" } });
    expect(await savePhoneDetails("d", { label: "x" })).toBe(false);
    rpc.mockRejectedValue(new Error("net"));
    expect(await savePhoneDetails("d", { label: "x" })).toBe(false);
  });
});

describe("removing a phone", () => {
  it("tries one last upload before it counts, and separates the signed-in account from others on the phone", async () => {
    const order: string[] = [];
    (flushOutbox as jest.Mock).mockImplementation(async () => void order.push("flush"));
    (countUnsentByOwner as jest.Mock).mockImplementation(async () => {
      order.push("count");
      return [
        { owner: "other", total: 9, danger: 9 },
        { owner: "u1", total: 3, danger: 1 },
      ];
    });
    expect(await lastTryAndCount("u1")).toEqual({ unsent: 3, urgent: 1, others: 9 });
    expect(order).toEqual(["flush", "count"]);
  });

  it("still counts when the last upload throws", async () => {
    (flushOutbox as jest.Mock).mockRejectedValue(new Error("offline"));
    (countUnsentByOwner as jest.Mock).mockResolvedValue([{ owner: "u1", total: 2, danger: 0 }]);
    expect(await lastTryAndCount("u1")).toEqual({ unsent: 2, urgent: 0, others: 0 });
  });

  it("an unreadable count is unknown (null), never zero", async () => {
    (flushOutbox as jest.Mock).mockResolvedValue({});
    (countUnsentByOwner as jest.Mock).mockRejectedValue(new Error("locked"));
    expect(await lastTryAndCount("u1")).toBeNull();
  });

  it("this phone is cleared only when its own check-in wiped it", async () => {
    (reportPhoneLost as jest.Mock).mockResolvedValue(true);
    (runDeviceCheck as jest.Mock).mockResolvedValue("wiped");
    expect(await removePhone("dev-this", true)).toBe("cleared");
  });

  it("this phone that could not check in is filed but NOT cleared", async () => {
    (reportPhoneLost as jest.Mock).mockResolvedValue(true);
    for (const o of ["offline", "skipped", "held"]) {
      (runDeviceCheck as jest.Mock).mockResolvedValue(o);
      expect(await removePhone("dev-this", true)).toBe("filed_not_cleared");
    }
  });

  it("another phone only files the request", async () => {
    (reportPhoneLost as jest.Mock).mockResolvedValue(true);
    expect(await removePhone("dev-other", false)).toBe("filed");
    expect(runDeviceCheck).not.toHaveBeenCalled();
  });

  it("a refused or thrown request changes nothing", async () => {
    (reportPhoneLost as jest.Mock).mockResolvedValue(false);
    expect(await removePhone("dev-this", true)).toBe("failed");
    (reportPhoneLost as jest.Mock).mockRejectedValue(new Error("x"));
    expect(await removePhone("dev-this", true)).toBe("failed");
    expect(runDeviceCheck).not.toHaveBeenCalled();
  });
});
