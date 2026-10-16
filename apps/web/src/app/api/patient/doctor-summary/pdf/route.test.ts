const getUser = jest.fn();
let mockProfile: { organisation_id: string | null; role: string } | null = { organisation_id: "org1", role: "patient" };
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
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockProfile }) }) }) }),
  }),
}));

import { POST } from "./route";

function post(fields: [string, string][]): Request {
  const form = new FormData();
  for (const [k, v] of fields) form.append(k, v);
  return new Request("http://localhost/api/patient/doctor-summary/pdf", { method: "POST", body: form });
}

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  mockProfile = { organisation_id: "org1", role: "patient" };
  getUser.mockResolvedValue({ data: { user: { id: "p1" } } });
  recordSummaryGeneration.mockImplementation(async () => {
    order.push("audit");
    return { ok: true as const };
  });
});

describe("POST /api/patient/doctor-summary/pdf", () => {
  it("answers 401 when not signed in and reads nothing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(post([["section", "bp"]]));
    expect(res.status).toBe(401);
    expect(loadDoctorSummary).not.toHaveBeenCalled();
    expect(recordSummaryGeneration).not.toHaveBeenCalled();
  });

  it("refuses a cross-site post", async () => {
    const form = new FormData();
    form.append("section", "bp");
    const res = await POST(new Request("http://localhost/api/patient/doctor-summary/pdf", { method: "POST", body: form, headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    expect(recordSummaryGeneration).not.toHaveBeenCalled();
  });

  it("answers 503, not an unhandled error, when the render throws", async () => {
    renderToBuffer.mockRejectedValueOnce(new Error("font"));
    expect((await POST(post([["section", "bp"]]))).status).toBe(503);
  });

  it("answers 404 for anyone who is not a patient (staff cannot build a summary here)", async () => {
    mockProfile = { organisation_id: "org1", role: "clinician" };
    const res = await POST(post([["section", "bp"]]));
    expect(res.status).toBe(404);
    expect(loadDoctorSummary).not.toHaveBeenCalled();
  });

  it("answers 400 for no section, only unknown sections, or a period that is not offered, with no audit row and no read", async () => {
    for (const fields of [[], [["section", "reproductive_health"]], [["section", "bp"], ["days", "365"]]] as [string, string][][]) {
      const res = await POST(post(fields));
      expect(res.status).toBe(400);
    }
    expect(recordSummaryGeneration).not.toHaveBeenCalled();
    expect(loadDoctorSummary).not.toHaveBeenCalled();
  });

  it("writes the audit row before it reads anything, keyed on the signed-in patient only", async () => {
    const res = await POST(post([["section", "bp"], ["section", "symptoms"], ["days", "60"]]));
    expect(res.status).toBe(200);
    expect(order).toEqual(["audit", "load"]);
    expect(recordSummaryGeneration).toHaveBeenCalledWith(expect.anything(), { id: "p1", organisationId: "org1" }, { days: 60, sections: ["bp", "symptoms"] });
    expect(loadDoctorSummary).toHaveBeenCalledWith(expect.anything(), "p1", { days: 60, sections: ["bp", "symptoms"] }, expect.any(Number), expect.anything());
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("ignores a patient id in the request: there is no way to ask for someone else's record", async () => {
    await POST(post([["section", "bp"], ["patient_id", "someone-else"], ["patientId", "someone-else"]]));
    expect(loadDoctorSummary).toHaveBeenCalledWith(expect.anything(), "p1", expect.anything(), expect.any(Number), expect.anything());
  });

  it("reads nothing and returns no document when the audit row cannot be written", async () => {
    recordSummaryGeneration.mockImplementation(async () => ({ ok: false as unknown as true }));
    const res = await POST(post([["section", "bp"]]));
    expect(res.status).toBe(503);
    expect(loadDoctorSummary).not.toHaveBeenCalled();
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("returns 503 and no PDF when a ticked section cannot be read", async () => {
    loadDoctorSummary.mockImplementationOnce(async () => ({ ok: false as unknown as true, data: { marker: "x" } }));
    const res = await POST(post([["section", "medicines"]]));
    expect(res.status).toBe(503);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });
});
