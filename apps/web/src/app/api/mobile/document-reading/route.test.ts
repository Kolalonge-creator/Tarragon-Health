/**
 * The phone's request to read an uploaded document photo (S43m): bearer auth, a uuid, and the same rules as the web action. A closed guard keeps
 * the photo and reaches no model; a stranger's document is a not-found; the answer never carries what was read.
 */
const getUser = jest.fn();
const requestReadingFor = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({ createBearerClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) } }) }));
jest.mock("@/lib/document-capture/request-reading", () => ({ requestReadingFor: (...a: unknown[]) => requestReadingFor(...a) }));

import { POST } from "./route";

const DOC = "11111111-1111-4111-8111-111111111111";
const req = (body: unknown, auth: string | null = "Bearer tok") =>
  new Request("http://localhost/api/mobile/document-reading", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "p1" } }, error: null });
  requestReadingFor.mockReset().mockResolvedValue({ success: true, status: "suggested", message: "Check each detail." });
});

describe("POST /api/mobile/document-reading", () => {
  it("refuses a missing or invalid session", async () => {
    expect((await POST(req({ document_id: DOC }, null))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect((await POST(req({ document_id: DOC }))).status).toBe(401);
    expect(requestReadingFor).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON or not a uuid", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({ document_id: "nope" }))).status).toBe(400);
    expect(requestReadingFor).not.toHaveBeenCalled();
  });

  it("asks for the reading as the person from the token, never from the body", async () => {
    const res = await POST(req({ document_id: DOC, patient_id: "someone-else" }));
    expect(res.status).toBe(200);
    expect(requestReadingFor).toHaveBeenCalledWith(expect.anything(), "p1", DOC);
  });

  it("a closed guard is an ordinary answer: the photo is kept, nothing was read", async () => {
    requestReadingFor.mockResolvedValue({ success: true, status: "closed", message: "Reading from photos is not open yet. Your photo is saved." });
    const res = await POST(req({ document_id: DOC }));
    expect(await res.json()).toEqual({ status: "closed", message: "Reading from photos is not open yet. Your photo is saved." });
  });

  it("someone else's or a missing document is a not-found with no detail", async () => {
    requestReadingFor.mockResolvedValue({ error: "That photo could not be found." });
    const res = await POST(req({ document_id: DOC }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ status: "refused", error: "That photo could not be found." });
  });

  it("a reading that failed is reported with the photo kept, and carries no extracted values", async () => {
    requestReadingFor.mockResolvedValue({ error: "We could not read that photo.", status: "failed" });
    const res = await POST(req({ document_id: DOC }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("failed");
    expect(JSON.stringify(json)).not.toMatch(/fields|extracted|ocr_text/);
  });
});
