/**
 * S70a on the Bluetooth ingestion route (18.1, 18.9). With every switch off the route is exactly what it was; with the plausibility hold or
 * de-duplication on, a successful insert is reported as held or merged when the database stored nothing in the record, a real extreme value is
 * no longer thrown away with a 400, and a device paired to someone the caller manages is written for that person.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
const assessBpControlBestEffort = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: (...a: unknown[]) => assessBpControlBestEffort(...a) }));
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: jest.fn() }));

interface World {
  holdOn: boolean;
  dedupeOn: boolean;
  ownDevice: boolean;
  target: { patient_id: string; organisation_id: string; is_supporter: boolean }[];
  savedRow: { id: string } | null;
  heldRow: { id: string; reasons: string[] } | null;
}
let world: World;
const insert = jest.fn();
const rpc = jest.fn();

jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => {
      if (table === "platform_modules") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { key: "device_plausibility_hold", is_enabled: world.holdOn },
                { key: "device_cross_source_dedupe", is_enabled: world.dedupeOn },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      if (table === "patient_devices") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: world.ownDevice ? { id: "dev-1" } : null }) }) }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "vitals_readings") {
        return {
          insert: async (row: unknown) => {
            insert(row);
            return { error: null };
          },
          select: () => {
            const b: Record<string, unknown> = {};
            b.eq = () => b;
            b.limit = () => b;
            b.maybeSingle = async () => ({ data: world.savedRow });
            return b;
          },
        };
      }
      if (table === "vitals_readings_held") {
        return {
          select: () => {
            const b: Record<string, unknown> = {};
            b.eq = () => b;
            b.order = () => b;
            b.limit = () => b;
            b.maybeSingle = async () => ({ data: world.heldRow });
            return b;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "./route";

const DEVICE = "33333333-3333-4333-8333-333333333333";
const bp = (over: Record<string, unknown> = {}) => ({
  vital_type: "blood_pressure",
  device_id: DEVICE,
  external_reading_id: "ext-1",
  taken_at: new Date().toISOString(),
  systolic: 128,
  diastolic: 82,
  ...over,
});
const call = (b: unknown) =>
  POST(new Request("http://x/api/mobile/device-readings", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(b) }));

beforeEach(() => {
  jest.clearAllMocks();
  world = { holdOn: false, dedupeOn: false, ownDevice: true, target: [], savedRow: { id: "row-1" }, heldRow: null };
  rpc.mockImplementation(async (fn: string) => (fn === "device_target_for_reading" ? { data: world.target, error: null } : { data: null, error: null }));
});

describe("device-readings route, S70a", () => {
  it("with every switch off still rejects a 270/130 value at the door, exactly as before", async () => {
    expect((await call(bp({ systolic: 270, diastolic: 130 }))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("with the hold on, passes an extreme but possible 270/130 to the database to be triaged", async () => {
    world.holdOn = true;
    const res = await call(bp({ systolic: 270, diastolic: 130 }));
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ systolic: 270, diastolic: 130, source: "device" }));
    expect(assessBpControlBestEffort).toHaveBeenCalled();
  });

  it("with the hold on, reports a value the database held, and runs no assessment on it", async () => {
    world.holdOn = true;
    world.savedRow = null;
    world.heldRow = { id: "held-1", reasons: ["systolic_range"] };
    const res = await call(bp({ systolic: 700 }));
    expect(await res.json()).toEqual({ success: true, held: true, held_id: "held-1", reasons: ["systolic_range"] });
    expect(assessBpControlBestEffort).not.toHaveBeenCalled();
  });

  it("with de-duplication on, reports a duplicate of a better source as merged", async () => {
    world.dedupeOn = true;
    world.savedRow = null;
    const res = await call(bp());
    expect(await res.json()).toEqual({ success: true, merged: true });
    expect(assessBpControlBestEffort).not.toHaveBeenCalled();
  });

  it("with a switch on and the reading stored, carries on exactly as before and emits the sync event", async () => {
    world.dedupeOn = true;
    const res = await call(bp());
    expect(await res.json()).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("report_device_synced", expect.objectContaining({ p_source: "ble" }));
  });

  it("writes a reading for the person whose device it is when the caller manages them, logged by the caller", async () => {
    world.ownDevice = false;
    world.target = [{ patient_id: "person-2", organisation_id: "org-2", is_supporter: true }];
    const res = await call(bp());
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ patient_id: "person-2", organisation_id: "org-2", logged_by_profile_id: "user-1" }));
    expect(assessBpControlBestEffort).toHaveBeenCalledWith(expect.anything(), "person-2", "org-2");
  });

  it("answers a stranger's device, an unpaired device and a view-only supporter alike with a 404", async () => {
    world.ownDevice = false;
    world.target = [];
    expect((await call(bp())).status).toBe(404);
    expect(insert).not.toHaveBeenCalled();
  });
});
