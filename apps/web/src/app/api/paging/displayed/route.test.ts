/** The service worker's "page shown" beacon (S19c): records a delivered receipt through the RPC for the signed-in recipient only. */
let rpcResult: { data: unknown; error: { message: string } | null } = { data: true, error: null };
let rpcCall: { fn: string; args: unknown } | null = null;
let user: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => user,
  createClient: async () => ({
    rpc: async (fn: string, args: unknown) => {
      rpcCall = { fn, args };
      return rpcResult;
    },
  }),
}));

import { POST } from "./route";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const req = (body: unknown) => new Request("http://x/api/paging/displayed", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  rpcResult = { data: true, error: null };
  rpcCall = null;
  user = { id: "11111111-1111-4111-8111-111111111111" };
});

describe("POST /api/paging/displayed", () => {
  it("records the receipt through record_notification_displayed", async () => {
    const res = await POST(req({ notificationId: ID }));
    expect(await res.json()).toEqual({ ok: true, recorded: true });
    expect(rpcCall).toEqual({ fn: "record_notification_displayed", args: { p_notification: ID } });
  });

  it("reports recorded false for a notification that is not the caller's page notification", async () => {
    rpcResult = { data: false, error: null };
    expect(await (await POST(req({ notificationId: ID }))).json()).toEqual({ ok: true, recorded: false });
  });

  it("is refused when nobody is signed in and never calls the database", async () => {
    user = null;
    const res = await POST(req({ notificationId: ID }));
    expect(res.status).toBe(401);
    expect(rpcCall).toBeNull();
  });

  it("rejects a malformed body", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req({ notificationId: "nope" }))).status).toBe(400);
    expect(rpcCall).toBeNull();
  });

  it("rate limits one user to a few calls a second and never calls the database for the refused ones", async () => {
    user = { id: "22222222-2222-4222-8222-222222222222" };
    let last = 200;
    for (let i = 0; i < 12; i++) last = (await POST(req({ notificationId: ID }))).status;
    expect(last).toBe(429);
    user = { id: "33333333-3333-4333-8333-333333333333" };
    expect((await POST(req({ notificationId: ID }))).status).toBe(200);
  });

  it("returns ok false with the message when the database errors, without throwing", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    expect(await (await POST(req({ notificationId: ID }))).json()).toEqual({ ok: false, error: "boom" });
  });
});
