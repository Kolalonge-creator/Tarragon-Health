const getUser = jest.fn();
const respond = jest.fn();
const createBearerClient = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: (...a: unknown[]) => {
    createBearerClient(...a);
    return { auth: { getUser } };
  },
}));
jest.mock("@/lib/emergency/lock-screen-image-response", () => ({
  lockScreenImageResponse: (...a: unknown[]) => respond(...a),
  lockScreenOptionsFromUrl: () => ({ includeQr: true, minimum: true }),
}));

import { GET } from "./route";

const req = (qs: string, headers: Record<string, string> = {}) =>
  new Request(`https://app.example.test/api/mobile/emergency-card/lock-screen-image${qs}`, { headers });

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  respond.mockResolvedValue(new Response("png", { status: 200 }));
});

describe("GET /api/mobile/emergency-card/lock-screen-image", () => {
  it("needs confirm=1 before anything else", async () => {
    expect((await GET(req("?token=t"))).status).toBe(400);
    expect(createBearerClient).not.toHaveBeenCalled();
  });

  it("needs a token (header or query)", async () => {
    expect((await GET(req("?confirm=1"))).status).toBe(401);
  });

  it("accepts the bearer header and the query token and builds the client from it", async () => {
    await GET(req("?confirm=1", { authorization: "Bearer hdr" }));
    expect(createBearerClient).toHaveBeenLastCalledWith("hdr");
    await GET(req("?confirm=1&token=qry"));
    expect(createBearerClient).toHaveBeenLastCalledWith("qry");
    expect(respond).toHaveBeenCalledTimes(2);
  });

  it("an invalid or expired session is 401 and nothing is drawn", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect((await GET(req("?confirm=1&token=bad"))).status).toBe(401);
    expect(respond).not.toHaveBeenCalled();
  });

  it("asks for an inline picture (shown in the in-app browser)", async () => {
    await GET(req("?confirm=1&token=t"));
    expect(respond.mock.calls[0]![0].disposition).toBe("inline");
  });

  it("uses the id of the session, never one from the request", async () => {
    await GET(req("?confirm=1&token=t&userId=other"));
    expect(respond.mock.calls[0]![0].userId).toBe("u1");
  });
});
