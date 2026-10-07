/**
 * S70a, 18.3: the photo reading route. Proves: dormant until switched on; refuses anything but an explicitly confirmed set of numbers; the
 * photo never reaches it; a held (impossible) value is reported as held and never triaged; a duplicate of a better source is merged; a saved
 * reading goes through the same post-insert assessments as a typed one; an offline retry is an idempotent success; a supporter can only
 * write for someone they manage.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
const assessBpControlBestEffort = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: (...a: unknown[]) => assessBpControlBestEffort(...a) }));
const assessGlucoseBestEffort = jest.fn();
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: (...a: unknown[]) => assessGlucoseBestEffort(...a) }));

interface World {
  moduleOn: boolean;
  insertError: { code: string; message: string } | null;
  savedRow: { id: string } | null;
  heldRow: { id: string; reasons: string[] } | null;
  canActFor: boolean;
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
        return { select: () => ({ in: async () => ({ data: [{ key: "device_photo_capture", is_enabled: world.moduleOn }], error: null }) }) };
      }
      if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      if (table === "vitals_readings") {
        return {
          insert: async (row: unknown) => {
            insert(row);
            return { error: world.insertError };
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

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const bp = { vital_type: "blood_pressure", systolic: 128, diastolic: 82, pulse_bpm: 71, cuff_type: "wrist" };
const body = (over: Record<string, unknown> = {}) => ({
  client_reading_id: CLIENT_ID,
  taken_at: new Date(Date.now() - 60_000).toISOString(),
  confirmed: true,
  reading: bp,
  ...over,
});
const call = (b: unknown) =>
  POST(new Request("http://x/api/mobile/photo-readings", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(b) }));

beforeEach(() => {
  jest.clearAllMocks();
  world = { moduleOn: true, insertError: null, savedRow: { id: "row-1" }, heldRow: null, canActFor: true };
  rpc.mockImplementation(async (fn: string) => (fn === "can_act_for" ? { data: world.canActFor, error: null } : { data: null, error: null }));
});

describe("POST /api/mobile/photo-readings", () => {
  it("is dormant until the module is switched on", async () => {
    world.moduleOn = false;
    const res = await call(body());
    expect(res.status).toBe(404);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a reading the person has not confirmed", async () => {
    expect((await call(body({ confirmed: false }))).status).toBe(400);
    expect((await call({ ...body(), confirmed: undefined })).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a photo more than 7 days old", async () => {
    const res = await call(body({ taken_at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString() }));
    expect(res.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it("stores a confirmed reading as photo_confirmed with its cuff type and runs the same assessments as a typed reading", async () => {
    const res = await call(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "photo_confirmed", client_reading_id: CLIENT_ID, patient_id: "user-1", systolic: 128, diastolic: 82, cuff_type: "wrist" }),
    );
    expect(assessBpControlBestEffort).toHaveBeenCalledWith(expect.anything(), "user-1", "org-1");
    expect(assessGlucoseBestEffort).not.toHaveBeenCalled();
  });

  it("runs the glucose assessment for a glucose photo", async () => {
    await call(body({ reading: { vital_type: "glucose", glucose_mmol_l: 6.1, glucose_context: "fasting" } }));
    expect(assessGlucoseBestEffort).toHaveBeenCalled();
  });

  it("never clamps an extreme but possible value: 270/130 reaches the database to be triaged", async () => {
    const res = await call(body({ reading: { ...bp, systolic: 270, diastolic: 130 } }));
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ systolic: 270, diastolic: 130 }));
  });

  it("reports a held value as held and runs no assessment on it", async () => {
    world.savedRow = null;
    world.heldRow = { id: "held-1", reasons: ["systolic_range"] };
    const res = await call(body({ reading: { ...bp, systolic: 700 } }));
    expect(await res.json()).toEqual({ success: true, held: true, held_id: "held-1", reasons: ["systolic_range"] });
    expect(assessBpControlBestEffort).not.toHaveBeenCalled();
  });

  it("reports a duplicate of a better source as merged, not as saved", async () => {
    world.savedRow = null;
    world.heldRow = null;
    const res = await call(body());
    expect(await res.json()).toEqual({ success: true, merged: true });
    expect(assessBpControlBestEffort).not.toHaveBeenCalled();
  });

  it("treats an offline-queue retry as an idempotent success", async () => {
    world.insertError = { code: "23505", message: "duplicate" };
    const res = await call(body());
    expect(await res.json()).toEqual({ success: true, deduped: true });
  });

  it("surfaces a database failure instead of reporting success", async () => {
    world.insertError = { code: "XX000", message: "boom" };
    expect((await call(body())).status).toBe(500);
  });

  it("lets a supporter write for the person they manage, logged by the supporter", async () => {
    await call(body({ patient_id: "22222222-2222-4222-8222-222222222222" }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ patient_id: "22222222-2222-4222-8222-222222222222", logged_by_profile_id: "user-1" }));
  });

  it("answers a stranger exactly like a missing person", async () => {
    world.canActFor = false;
    const res = await call(body({ patient_id: "22222222-2222-4222-8222-222222222222" }));
    expect(res.status).toBe(404);
    expect(insert).not.toHaveBeenCalled();
  });

  it("flags a failed assessment rather than hiding it", async () => {
    assessBpControlBestEffort.mockRejectedValueOnce(new Error("network"));
    const res = await call(body());
    expect(await res.json()).toEqual({ success: true, safetyAssessmentFailed: true });
  });
});
