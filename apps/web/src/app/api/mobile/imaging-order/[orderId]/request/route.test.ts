/** The phone's imaging request PDF: no token is 401, a bad session is 401, an order the caller cannot read is 404, a readable one is an inline PDF. */
const getUser = jest.fn();
const generate = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({ createBearerClient: () => ({ auth: { getUser } }) }));
jest.mock("@/lib/imaging-orders/generate-imaging-request-pdf", () => ({ generateImagingRequestPdf: (...a: unknown[]) => generate(...a) }));

import { GET } from "./route";

const params = { params: Promise.resolve({ orderId: "o1" }) };
beforeEach(() => { getUser.mockReset(); generate.mockReset(); });

describe("GET /api/mobile/imaging-order/[orderId]/request", () => {
  it("refuses a request with no token", async () => {
    expect((await GET(new Request("https://x/api"), params)).status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });
  it("refuses an expired session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect((await GET(new Request("https://x/api?token=t"), params)).status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });
  it("is a plain 404 when the order is not the caller's", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    generate.mockResolvedValue({ ok: false });
    expect((await GET(new Request("https://x/api", { headers: { authorization: "Bearer t" } }), params)).status).toBe(404);
  });
  it("serves the PDF inline", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    generate.mockResolvedValue({ ok: true, buffer: Buffer.from("pdf"), filename: "IMG-1.pdf" });
    const res = await GET(new Request("https://x/api?token=t"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('inline; filename="IMG-1.pdf"');
    expect(generate).toHaveBeenCalledWith(expect.anything(), "o1");
  });
});
