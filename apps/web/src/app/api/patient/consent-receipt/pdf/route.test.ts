const getUser = jest.fn();
const rpc = jest.fn();
const renderToBuffer = jest.fn(async (..._a: unknown[]) => Buffer.from("%PDF-fake"));
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
  Font: { register: jest.fn() },
  renderToBuffer: (...a: unknown[]) => renderToBuffer(...a),
}));
jest.mock("@sentry/nextjs", () => ({ captureMessage: jest.fn() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

import { GET } from "./route";

const ID = "5f3b0c2e-8a41-4d6e-9d3a-1b2c3d4e5f60";
const req = (qs: string) => new Request(`https://app.example.test/api/patient/consent-receipt/pdf${qs}`);

const matrixPayload = {
  scope: "matrix_event",
  person: "Ada Obi",
  generated_at: "2026-10-20T10:00:00Z",
  change: {
    data_type: "vitals", purpose: "research", action: "granted", source: "patient", policy_version: 1,
    text_key: "consent.matrix.vitals.research", wording_status: "draft_pending_counsel", required_for_care: false, wording_current: true, at: "2026-10-19T08:30:00Z",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
});

describe("GET /api/patient/consent-receipt/pdf", () => {
  it("a signed-out caller gets 401 and nothing is read", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(req("?scope=all"));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("the whole picture asks the database for scope all with no id", async () => {
    rpc.mockResolvedValue({ data: { scope: "all", person: "Ada Obi", generated_at: "2026-10-20T10:00:00Z", cells: [], documents: [] }, error: null });
    const res = await GET(req("?scope=all"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("consent_receipt_data", { p_scope: "all", p_ref: undefined });
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("defaults to the whole picture when no scope is given", async () => {
    rpc.mockResolvedValue({ data: { scope: "all", person: null, generated_at: "2026-10-20T10:00:00Z", cells: [], documents: [] }, error: null });
    expect((await GET(req(""))).status).toBe(200);
  });

  it("one change passes only the id, and the file name carries nothing about the person or the choice", async () => {
    rpc.mockResolvedValue({ data: matrixPayload, error: null });
    const res = await GET(req(`?scope=matrix_event&id=${ID}`));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("consent_receipt_data", { p_scope: "matrix_event", p_ref: ID });
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="consent-receipt-\d{4}-\d{2}-\d{2}\.pdf"$/);
    expect(disposition).not.toMatch(/ada|vitals|research/i);
  });

  it("a change scope without a valid id is 400 and the database is not asked", async () => {
    expect((await GET(req("?scope=matrix_event"))).status).toBe(400);
    expect((await GET(req("?scope=matrix_event&id=not-a-uuid"))).status).toBe(400);
    expect((await GET(req("?scope=everything"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a role that is not a patient is refused by the database and the route answers 404 (clinician, admin, caregiver)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "consent_not_authorised" } });
    for (const role of ["clinician", "admin", "caregiver"]) {
      getUser.mockResolvedValue({ data: { user: { id: `u-${role}` } } });
      const res = await GET(req("?scope=all"));
      expect(res.status).toBe(404);
    }
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("someone else's entry is the same 404 as a missing one (no oracle) and renders nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "consent_receipt_not_found" } });
    const res = await GET(req(`?scope=document_event&id=${ID}`));
    expect(res.status).toBe(404);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });

  it("a database error is 503, never an empty receipt", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await GET(req("?scope=all"))).status).toBe(503);
  });

  it("a malformed answer is 503, never a shorter receipt", async () => {
    rpc.mockResolvedValue({ data: { scope: "all", cells: [{ data_type: "weight" }] }, error: null });
    const res = await GET(req("?scope=all"));
    expect(res.status).toBe(503);
    expect(renderToBuffer).not.toHaveBeenCalled();
  });
});
