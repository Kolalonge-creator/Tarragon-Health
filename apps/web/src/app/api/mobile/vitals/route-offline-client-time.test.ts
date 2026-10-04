/**
 * S06: the phone's own clock reaches the database as client_recorded_at and
 * never as taken_at. taken_at is set by private.stamp_manual_vitals_timestamp
 * (which keeps the device time only inside a bounded window), so the route
 * must not try to set it from the request.
 */
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));
const captureException = jest.fn();

const assessBpControlBestEffort = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({
  assessBpControlBestEffort: (...args: unknown[]) => assessBpControlBestEffort(...args),
}));
const assessHeartRateBestEffort = jest.fn();
jest.mock("@/lib/vitals/assess-heart-rate", () => ({
  assessHeartRateBestEffort: (...args: unknown[]) => assessHeartRateBestEffort(...args),
}));
const assessGlucoseBestEffort = jest.fn();
jest.mock("@/lib/vitals/assess-glucose", () => ({
  assessGlucoseBestEffort: (...args: unknown[]) => assessGlucoseBestEffort(...args),
}));
const assessHealthScoreBestEffort = jest.fn();
jest.mock("@/lib/health-score/assess-health-score", () => ({
  assessHealthScoreBestEffort: (...args: unknown[]) => assessHealthScoreBestEffort(...args),
}));

const insert = jest.fn();
const single = jest.fn();
const getUser = jest.fn();

jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single }) }) };
      }
      if (table === "vitals_readings") {
        return { insert };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: jest.fn(),
  }),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return new Request("https://app.tarragonhealth.ng/api/mobile/vitals", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/vitals: offline device time", () => {
  beforeEach(() => {
    captureException.mockReset();
    assessBpControlBestEffort.mockReset().mockResolvedValue(undefined);
    assessHeartRateBestEffort.mockReset().mockResolvedValue(undefined);
    assessGlucoseBestEffort.mockReset().mockResolvedValue(undefined);
    assessHealthScoreBestEffort.mockReset().mockResolvedValue(undefined);
    getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
    single.mockResolvedValue({ data: { organisation_id: "org-1" } });
    insert.mockReset().mockResolvedValue({ error: null });
  });

  it("passes the device time as client_recorded_at and sets taken_at to server time", async () => {
    const before = Date.now();
    const device = "2026-10-02T08:00:00.000Z";
    const res = await POST(request({ vital_type: "pulse", pulse_bpm: 72, taken_at: device, client_reading_id: "5b1f1b6e-2d6c-4b7e-8d57-1f0e7d0c9a11" }));
    expect(res.status).toBe(200);
    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.client_recorded_at).toBe(device);
    expect(new Date(row.taken_at as string).getTime()).toBeGreaterThanOrEqual(before);
    expect(row.client_reading_id).toBe("5b1f1b6e-2d6c-4b7e-8d57-1f0e7d0c9a11");
  });

  it("sends a null client_recorded_at when the phone gave no time", async () => {
    await POST(request({ vital_type: "pulse", pulse_bpm: 72 }));
    expect((insert.mock.calls[0][0] as Record<string, unknown>).client_recorded_at).toBeNull();
  });

  it("a replayed client_reading_id (23505) is still a success and does not re-run the assessors", async () => {
    insert.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });
    const res = await POST(
      request({ vital_type: "pulse", pulse_bpm: 72, client_reading_id: "5b1f1b6e-2d6c-4b7e-8d57-1f0e7d0c9a11" })
    );
    expect(res.status).toBe(200);
    expect(assessHeartRateBestEffort).not.toHaveBeenCalled();
  });
});
