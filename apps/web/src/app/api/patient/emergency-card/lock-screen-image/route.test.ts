const getUser = jest.fn();
const respond = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
jest.mock("@/lib/emergency/lock-screen-image-response", () => ({
  lockScreenImageResponse: (...a: unknown[]) => respond(...a),
  lockScreenOptionsFromUrl: (u: URL) => ({ includeQr: u.searchParams.get("qr") !== "0", minimum: u.searchParams.get("minimum") !== "0" }),
}));

import { GET } from "./route";

const req = (qs: string) => new Request(`https://app.example.test/api/patient/emergency-card/lock-screen-image${qs}`);

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  respond.mockResolvedValue(new Response("png", { status: 200 }));
});

describe("GET /api/patient/emergency-card/lock-screen-image", () => {
  it("needs the explicit confirm and does nothing without it", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("?confirm=0"))).status).toBe(400);
    expect(getUser).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it("a signed-out caller is 401", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(req("?confirm=1"))).status).toBe(401);
    expect(respond).not.toHaveBeenCalled();
  });

  it("passes the caller's own id and the options (QR off, minimum off only when asked)", async () => {
    await GET(req("?confirm=1&qr=0&minimum=0"));
    expect(respond.mock.calls[0]![0]).toMatchObject({ userId: "u1", options: { includeQr: false, minimum: false } });
    await GET(req("?confirm=1"));
    expect(respond.mock.calls[1]![0]).toMatchObject({ userId: "u1", options: { includeQr: true, minimum: true } });
  });

  it("takes no patient id from the request", async () => {
    await GET(req("?confirm=1&patient=someone-else&userId=someone-else"));
    expect(respond.mock.calls[0]![0].userId).toBe("u1");
  });
});
