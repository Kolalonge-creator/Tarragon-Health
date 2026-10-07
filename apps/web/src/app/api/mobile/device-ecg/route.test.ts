/** S70 (18.6): the route that carries a personal ECG device's own result to the database function. */
const getUser = jest.fn();
const rpc = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) }, rpc: (...a: unknown[]) => rpc(...a) }),
}));

import { POST } from "./route";

const req = (body: unknown, token: string | null = "t") =>
  new Request("https://app.tarragonhealth.ng/api/mobile/device-ecg", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const ok = { classification: "irregular_rhythm", provider: "apple_watch", device_result_text: "Atrial fibrillation", recorded_at: "2026-10-07T08:00:00Z" };

describe("POST /api/mobile/device-ecg", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "p1" } }, error: null });
    rpc.mockReset().mockResolvedValue({ data: { alert: true, reviewed_by_care_team: true }, error: null });
  });

  it("needs a signed-in patient", async () => {
    expect((await POST(req(ok, null))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect((await POST(req(ok))).status).toBe(401);
  });

  it("passes only the device's own classification to the database and answers with a review flag, never a rhythm name", async () => {
    const res = await POST(req(ok));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("report_device_ecg_result", {
      p_classification: "irregular_rhythm",
      p_provider: "apple_watch",
      p_device_result_text: "Atrial fibrillation",
      p_recorded_at: "2026-10-07T08:00:00.000Z",
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ success: true, review: true, capped: false });
    expect(JSON.stringify(body)).not.toMatch(/fibrillation|rhythm|arrhythmia|diagnos/i);
  });

  it("a normal result answers with no review", async () => {
    rpc.mockResolvedValue({ data: { alert: false }, error: null });
    const body = (await (await POST(req({ ...ok, classification: "sinus_rhythm" }))).json()) as Record<string, unknown>;
    expect(body.review).toBe(false);
  });

  it("rejects a classification the vocabulary does not have, and bad JSON", async () => {
    expect((await POST(req({ ...ok, classification: "afib" }))).status).toBe(400);
    expect((await POST(req("{not json"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a database refusal of the value to 400 and any other failure to 500", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "the recording time is out of range" } });
    expect((await POST(req(ok))).status).toBe(400);
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await POST(req(ok))).status).toBe(500);
  });
});
