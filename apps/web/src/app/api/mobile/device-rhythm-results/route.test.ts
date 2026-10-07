/**
 * S70a, 18.6: a personal ECG device's own rhythm result. Proves: dormant until switched on; the label goes to the database verbatim; the phone
 * is handed only the fixed sentence and a red-path flag, never a category or a diagnosis; a stranger is answered like a missing person.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
let moduleOn = true;
const rpc = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => {
      if (table === "platform_modules") {
        return { select: () => ({ in: async () => ({ data: [{ key: "device_ecg_rhythm_alerts", is_enabled: moduleOn }], error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));
import { POST } from "./route";

const call = (b: unknown) =>
  POST(new Request("http://x/api/mobile/device-rhythm-results", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(b) }));
const valid = { source: "healthkit_ecg", device_label: "Atrial Fibrillation", recorded_at: new Date().toISOString(), external_id: "ecg-1" };

beforeEach(() => {
  jest.clearAllMocks();
  moduleOn = true;
  rpc.mockResolvedValue({
    data: { ok: true, category: "irregular", patient_copy: "Your device flagged something for your care team to look at.", red_path: false, duplicate: false },
    error: null,
  });
});

describe("POST /api/mobile/device-rhythm-results", () => {
  it("is dormant until the module is switched on", async () => {
    moduleOn = false;
    expect((await call(valid)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the device's own label to the database verbatim", async () => {
    await call({ ...valid, device_label: "  Inconclusive: poor recording  " });
    expect(rpc).toHaveBeenCalledWith("record_device_rhythm_result", expect.objectContaining({ p_device_label: "Inconclusive: poor recording", p_source: "healthkit_ecg" }));
  });

  it("hands the phone only the fixed sentence: no category, no label, no diagnosis", async () => {
    const res = await call(valid);
    const json = await res.json();
    expect(json).toEqual({ success: true, duplicate: false, patient_copy: "Your device flagged something for your care team to look at.", red_path: false });
    expect(JSON.stringify(json)).not.toMatch(/irregular|fibrillation|category/i);
  });

  it("tells the phone to show the existing emergency guidance when a red symptom was answered yes", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, category: "irregular", patient_copy: "x", red_path: true, duplicate: false }, error: null });
    const res = await call({ ...valid, symptoms: ["chest_pain"] });
    expect((await res.json()).red_path).toBe(true);
    expect(rpc).toHaveBeenCalledWith("record_device_rhythm_result", expect.objectContaining({ p_symptoms: ["chest_pain"] }));
  });

  it("refuses a symptom it does not know and an empty label", async () => {
    expect((await call({ ...valid, symptoms: ["headache"] })).status).toBe(400);
    expect((await call({ ...valid, device_label: "   " })).status).toBe(400);
  });

  it("answers a stranger exactly like a missing person", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not allowed" } });
    expect((await call({ ...valid, patient_id: "22222222-2222-4222-8222-222222222222" })).status).toBe(404);
  });

  it("does not report success when the database fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await call(valid)).status).toBe(500);
  });
});
