/**
 * The letter route is the person's own: another person's request id is a plain 404 (the function returns only the signed-in person's rows), a
 * signed-out caller is 401, and a good call returns a PDF that is not cached. The PDF renderer and fonts are mocked: the layout has its own test.
 */
const rpc = jest.fn();
const getUser = jest.fn();
const single = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { getUser: () => getUser() },
    from: () => ({ select: () => ({ eq: () => ({ single: () => single() }) }) }),
  }),
}));
jest.mock("@react-pdf/renderer", () => ({
  Document: "Document",
  Page: "Page",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: async () => Buffer.from("%PDF-test"),
}));
jest.mock("@/lib/pdf/register-fonts", () => ({ registerPdfFonts: () => undefined, PDF_FONT_FAMILY: "Noto Sans" }));

import { GET } from "./route";

const ID = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const call = (id: string) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  single.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  single.mockResolvedValue({ data: { full_name: "Ada Obi", date_of_birth: "1980-05-01", phone: "+2348012345678" } });
});

describe("GET /api/patient/records-requests/[id]/letter", () => {
  it("404s a malformed id without asking the database", async () => {
    expect((await call("nope")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401s a signed-out caller", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await call(ID)).status).toBe(401);
  });

  it("404s a request that is not among the person's own rows", async () => {
    rpc.mockResolvedValue({ data: [{ id: "someone-elses", facility_name: "X", scope_codes: ["lab_results"], letter_version: "records_request.letter@1", requested_at: null }], error: null });
    expect((await call(ID)).status).toBe(404);
  });

  it("500s plainly when the list cannot be read, never a blank letter", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await call(ID)).status).toBe(500);
  });

  it("refuses to make a letter without a name, rather than printing a blank one", async () => {
    rpc.mockResolvedValue({ data: [{ id: ID, facility_name: "Lagos General", scope_codes: ["lab_results"], letter_version: "records_request.letter@1", requested_at: null }], error: null });
    single.mockResolvedValue({ data: { full_name: " ", date_of_birth: null, phone: null } });
    expect((await call(ID)).status).toBe(422);
  });

  it("500s when the stored wording version no longer exists, rather than printing other wording", async () => {
    rpc.mockResolvedValue({ data: [{ id: ID, facility_name: "Lagos General", scope_codes: ["lab_results"], letter_version: "records_request.letter@999", requested_at: null }], error: null });
    expect((await call(ID)).status).toBe(500);
  });

  it("returns a PDF that is not cached for the person's own request", async () => {
    rpc.mockResolvedValue({ data: [{ id: ID, facility_name: "Lagos General", scope_codes: ["lab_results", "mental_health"], letter_version: "records_request.letter@1", requested_at: null }], error: null });
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
