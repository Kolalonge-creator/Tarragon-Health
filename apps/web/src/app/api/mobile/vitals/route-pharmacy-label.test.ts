/**
 * S07y: a blood pressure the person took at a pharmacy or clinic machine is saved as an ORDINARY manual reading with the label entry_origin = pharmacy_machine.
 * So every safety assessment still runs for it exactly as for a home reading; the label only keeps it out of the home average (in the database). A closed guard
 * (55000) never loses the reading: a dangerous value must not be dropped by a go-live switch, so it is saved as an ordinary reading with the setting in its note.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
const assessBpControlBestEffort = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: (...a: unknown[]) => assessBpControlBestEffort(...a) }));
jest.mock("@/lib/vitals/assess-heart-rate", () => ({ assessHeartRateBestEffort: jest.fn() }));
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: jest.fn() }));
jest.mock("@/lib/health-score/assess-health-score", () => ({ assessHealthScoreBestEffort: jest.fn() }));

const insert = jest.fn();
const single = jest.fn();
const getUser = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ single }) }) };
      if (table === "vitals_readings") return { insert };
      throw new Error(`unexpected table ${table}`);
    },
    rpc: jest.fn(),
  }),
}));

import { POST } from "./route";

const ID = "5b1f1b6e-2d6c-4b7e-8d57-1f0e7d0c9a11";
function request(body: Record<string, unknown>): Request {
  return new Request("https://app.tarragonhealth.ng/api/mobile/vitals", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  assessBpControlBestEffort.mockReset().mockResolvedValue(undefined);
  getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
  single.mockResolvedValue({ data: { organisation_id: "org-1" } });
  insert.mockReset().mockResolvedValue({ error: null });
});

describe("POST /api/mobile/vitals: taken at a pharmacy or clinic machine", () => {
  it("saves a manual reading with the label and the place, and still runs the blood pressure assessment", async () => {
    const res = await POST(request({ vital_type: "blood_pressure", systolic: 148, diastolic: 92, entry_origin: "pharmacy_machine", place_label: "  Corner   Pharmacy ", client_reading_id: ID }));
    expect(res.status).toBe(200);
    expect(insert.mock.calls[0]?.[0]).toMatchObject({ source: "manual", vital_type: "blood_pressure", entry_origin: "pharmacy_machine", place_label: "Corner Pharmacy" });
    expect(assessBpControlBestEffort).toHaveBeenCalledTimes(1);
  });

  it("an ordinary reading carries no label and no place", async () => {
    await POST(request({ vital_type: "blood_pressure", systolic: 128, diastolic: 82, place_label: "Somewhere" }));
    const row = insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.entry_origin ?? null).toBeNull();
    // a place without the label would be refused by the database, so it is dropped here
    expect(row.place_label ?? null).toBeNull();
  });

  it("a blank place is not sent (the database refuses a blank place)", async () => {
    await POST(request({ vital_type: "blood_pressure", systolic: 128, diastolic: 82, entry_origin: "pharmacy_machine", place_label: "   " }));
    const row = insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.entry_origin).toBe("pharmacy_machine");
    expect(row.place_label ?? null).toBeNull();
  });

  it("refuses any label but the one it knows", async () => {
    expect((await POST(request({ vital_type: "blood_pressure", systolic: 128, diastolic: 82, entry_origin: "paper_diary" }))).status).toBe(400);
    expect((await POST(request({ vital_type: "blood_pressure", systolic: 128, diastolic: 82, entry_origin: "kiosk" }))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("a closed guard (55000) never loses the reading: it is saved as an ORDINARY one with the setting in its note, the assessment still runs, and the answer says so", async () => {
    insert.mockResolvedValueOnce({ error: { code: "55000", message: "this kind of reading is not switched on yet (pharmacy_bp_readings)" } }).mockResolvedValueOnce({ error: null });
    const res = await POST(request({ vital_type: "blood_pressure", systolic: 188, diastolic: 118, entry_origin: "pharmacy_machine", place_label: "Corner", note: "after a walk", client_reading_id: ID }));
    expect(res.status).toBe(200);
    expect((await res.json()).label_dropped).toBe(true);
    expect(insert).toHaveBeenCalledTimes(2);
    const retry = insert.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(retry).toMatchObject({ vital_type: "blood_pressure", systolic: 188, diastolic: 118, source: "manual", client_reading_id: ID });
    expect(retry.entry_origin).toBeUndefined();
    expect(retry.place_label).toBeUndefined();
    expect(retry.note).toBe("Taken at a pharmacy or clinic machine. (Corner) after a walk");
    expect(assessBpControlBestEffort).toHaveBeenCalledTimes(1);
  });

  it("a 55000 that is not about the label (any other vital) is an ordinary failure, never a pharmacy message and never a retry", async () => {
    insert.mockResolvedValue({ error: { code: "55000", message: "event bus has no active config" } });
    const res = await POST(request({ vital_type: "weight", weight_kg: 70 }));
    expect(res.status).toBe(500);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("if the retry without the label also fails, that failure is the answer", async () => {
    insert.mockResolvedValueOnce({ error: { code: "55000", message: "this kind of reading is not switched on yet (pharmacy_bp_readings)" } }).mockResolvedValueOnce({ error: { code: "XX000", message: "db down" } });
    const res = await POST(request({ vital_type: "blood_pressure", systolic: 148, diastolic: 92, entry_origin: "pharmacy_machine" }));
    expect(res.status).toBe(500);
    expect(assessBpControlBestEffort).not.toHaveBeenCalled();
  });
});
