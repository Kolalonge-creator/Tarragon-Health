/**
 * S70 (18.3): a reading confirmed from a photo of a device screen.
 * Stored as a device-source reading with the photo-confirmed label (so the source lock stops later rewriting), through the same
 * schema bounds and the same assessors as a typed reading. The photo itself is not part of the request or the row.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: (...args: unknown[]) => captureException(...args) }));
const captureException = jest.fn();

const assessBpControlBestEffort = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: (...args: unknown[]) => assessBpControlBestEffort(...args) }));
jest.mock("@/lib/vitals/assess-heart-rate", () => ({ assessHeartRateBestEffort: jest.fn().mockResolvedValue(undefined) }));
const assessGlucoseBestEffort = jest.fn();
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: (...args: unknown[]) => assessGlucoseBestEffort(...args) }));
jest.mock("@/lib/health-score/assess-health-score", () => ({ assessHealthScoreBestEffort: jest.fn().mockResolvedValue(undefined) }));

const insert = jest.fn();
const single = jest.fn();
const getUser = jest.fn();
const rpc = jest.fn();

jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ single }) }) };
      if (table === "vitals_readings") return { insert };
      throw new Error(`unexpected table ${table}`);
    },
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

import { POST } from "./route";

const req = (body: Record<string, unknown>) =>
  new Request("https://app.tarragonhealth.ng/api/mobile/vitals", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/mobile/vitals with capture_method photo", () => {
  beforeEach(() => {
    captureException.mockReset();
    assessBpControlBestEffort.mockReset().mockResolvedValue(undefined);
    assessGlucoseBestEffort.mockReset().mockResolvedValue(undefined);
    getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
    single.mockResolvedValue({ data: { organisation_id: "org-1" } });
    insert.mockReset().mockResolvedValue({ error: null });
    rpc.mockReset().mockResolvedValue({ data: "event-1", error: null });
  });

  it("stores a device-source row labelled photo-confirmed, with server time and no image", async () => {
    const res = await POST(req({ vital_type: "blood_pressure", systolic: 128, diastolic: 82, cuff_type: "wrist", capture_method: "photo" }));
    expect(res.status).toBe(200);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ source: "device", photo_confirmed: true, systolic: 128, diastolic: 82, cuff_type: "wrist", patient_id: "patient-1" });
    expect(row.device_id).toBeUndefined();
    expect(JSON.stringify(row)).not.toMatch(/uri|base64|image/i);
    expect(typeof row.taken_at).toBe("string");
  });

  it("a manual reading is unchanged: source manual, not photo-confirmed", async () => {
    await POST(req({ vital_type: "pulse", pulse_bpm: 72 }));
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.source).toBe("manual");
    expect(row.photo_confirmed).toBeUndefined();
  });

  it("applies the same bounds as a typed reading: an impossible number is refused", async () => {
    const res = await POST(req({ vital_type: "blood_pressure", systolic: 400, diastolic: 82, capture_method: "photo" }));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("a crisis-range photo reading still reaches the insert and the blood pressure assessor (triage is not skipped)", async () => {
    const res = await POST(req({ vital_type: "blood_pressure", systolic: 215, diastolic: 125, capture_method: "photo" }));
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(assessBpControlBestEffort).toHaveBeenCalledTimes(1);
  });

  it("a glucose photo reading runs the glucose assessor like a typed one", async () => {
    await POST(req({ vital_type: "glucose", glucose_value: 2.4, glucose_unit: "mmol_l", glucose_context: "random", capture_method: "photo" }));
    expect(assessGlucoseBestEffort).toHaveBeenCalledTimes(1);
  });

  it("records one device.synced with the photo kind, counts only", async () => {
    await POST(req({ vital_type: "weight", weight_kg: 74.5, capture_method: "photo" }));
    expect(rpc).toHaveBeenCalledWith("record_device_sync", expect.objectContaining({ p_provider: "photo_capture", p_source_kind: "photo", p_reading_count: 1 }));
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/74/);
  });

  it("a failed event never fails the save", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "bus down" } });
    const res = await POST(req({ vital_type: "weight", weight_kg: 74.5, capture_method: "photo" }));
    expect(res.status).toBe(200);
  });

  it("an unknown capture method is ignored: the reading stays manual", async () => {
    await POST(req({ vital_type: "pulse", pulse_bpm: 72, capture_method: "bluetooth" }));
    expect((insert.mock.calls[0][0] as Record<string, unknown>).source).toBe("manual");
  });
});
