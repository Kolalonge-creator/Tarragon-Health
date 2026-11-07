/**
 * The credential document route: a document held for its malware scan answers 423 with a plain sentence (only after the database
 * has confirmed the caller may see it), never the bytes; anything else the database refuses stays a 404.
 */
const rpc = jest.fn();
const download = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: (...a: unknown[]) => rpc(...a), auth: { getUser: async () => ({ data: { user: { id: "u" } } }) } }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ storage: { from: () => ({ download: (...a: unknown[]) => download(...a) }) } }),
}));

import { GET } from "./route";

const DOC = "11111111-1111-4111-8111-111111111111";
const call = () => GET(new Request("http://x"), { params: Promise.resolve({ documentId: DOC }) });

beforeEach(() => {
  rpc.mockReset();
  download.mockReset().mockResolvedValue({ data: new Blob(["%PDF"], { type: "application/pdf" }), error: null });
});

describe("GET credential document", () => {
  it("answers 423 with a plain sentence for a held document and reads no bytes", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "document_held: this document is waiting for its safety check" } });
    const res = await call();
    expect(res.status).toBe(423);
    expect(await res.text()).toMatch(/waiting for its safety check/);
    expect(download).not.toHaveBeenCalled();
  });

  it("keeps a 404 for a document the caller may not see", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "document not found" } });
    expect((await call()).status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("serves a cleared document", async () => {
    rpc.mockResolvedValue({ data: "o/u/doc.pdf", error: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect(download).toHaveBeenCalledWith("o/u/doc.pdf");
  });
});
