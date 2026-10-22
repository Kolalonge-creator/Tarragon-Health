/**
 * Item 10: the phone's result passport route. Proves: needs a session; 404 while result_passport_enabled is closed (also on an RPC error)
 * with nothing read or audited; patients only; the audit row is written before any read; no patient id is ever taken from the request.
 */
const rpc = jest.fn();
let profile: { organisation_id: string | null; role: string } | null = { organisation_id: "org1", role: "patient" };
const order: string[] = [];
const recordSummaryGeneration = jest.fn(async () => {
  order.push("audit");
  return { ok: true as const };
});
const loadDoctorSummary = jest.fn(async () => {
  order.push("load");
  return { ok: true as const, data: { marker: "data" } };
});
const renderToBuffer = jest.fn(async () => Buffer.from("%PDF-fake"));

jest.mock("@react-pdf/renderer", () => ({ renderToBuffer: (...a: unknown[]) => (renderToBuffer as (...x: unknown[]) => unknown)(...a) }));
jest.mock("@/lib/doctor-summary-pdf/document", () => ({ DoctorSummaryPdfDocument: () => "doc" }));
jest.mock("@/lib/doctor-summary-pdf/load", () => ({
  recordSummaryGeneration: (...a: unknown[]) => (recordSummaryGeneration as (...x: unknown[]) => unknown)(...a),
  loadDoctorSummary: (...a: unknown[]) => (loadDoctorSummary as (...x: unknown[]) => unknown)(...a),
}));
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "p1" } }, error: null }) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
  }),
}));

import { POST } from "./route";

const req = (body: unknown, auth = true) =>
  new Request("http://localhost/api/mobile/result-passport/pdf", {
    method: "POST",
    headers: auth ? { authorization: "Bearer t", "content-type": "application/json" } : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  profile = { organisation_id: "org1", role: "patient" };
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("POST /api/mobile/result-passport/pdf", () => {
  it("needs a session", async () => {
    expect((await POST(req({ sections: ["glucose"] }, false))).status).toBe(401);
  });

  it("is 404 while the guard is closed or unreadable, and reads and audits nothing", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await POST(req({ sections: ["glucose"] }))).status).toBe(404);
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await POST(req({ sections: ["glucose"] }))).status).toBe(404);
    expect(recordSummaryGeneration).not.toHaveBeenCalled();
    expect(loadDoctorSummary).not.toHaveBeenCalled();
  });

  it("is for patients only", async () => {
    profile = { organisation_id: "org1", role: "clinician" };
    expect((await POST(req({ sections: ["glucose"] }))).status).toBe(404);
    expect(loadDoctorSummary).not.toHaveBeenCalled();
  });

  it("refuses no section, an unknown section and a period that is not offered", async () => {
    expect((await POST(req({ sections: [] }))).status).toBe(400);
    expect((await POST(req({ sections: ["reproductive_health"] }))).status).toBe(400);
    expect((await POST(req({ sections: ["glucose"], days: 365 }))).status).toBe(400);
    expect(recordSummaryGeneration).not.toHaveBeenCalled();
  });

  it("writes the audit row first, reads only the signed-in person's record and returns a no-store PDF", async () => {
    const res = await POST(req({ sections: ["glucose", "lab_results"], days: 60, patient_id: "someone-else" }));
    expect(res.status).toBe(200);
    expect(order).toEqual(["audit", "load"]);
    expect(recordSummaryGeneration).toHaveBeenCalledWith(expect.anything(), { id: "p1", organisationId: "org1" }, { days: 60, sections: ["glucose", "lab_results"] });
    expect(loadDoctorSummary).toHaveBeenCalledWith(expect.anything(), "p1", { days: 60, sections: ["glucose", "lab_results"] }, expect.any(Number), expect.anything());
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 503 and no document when the audit row cannot be written or a section cannot be read", async () => {
    recordSummaryGeneration.mockImplementationOnce(async () => ({ ok: false as unknown as true }));
    expect((await POST(req({ sections: ["glucose"] }))).status).toBe(503);
    expect(loadDoctorSummary).not.toHaveBeenCalled();
    loadDoctorSummary.mockImplementationOnce(async () => ({ ok: false as unknown as true, data: { marker: "x" } }));
    expect((await POST(req({ sections: ["glucose"] }))).status).toBe(503);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });
});
