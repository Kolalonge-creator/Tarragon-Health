/** The web push tap beacon (public/sw.js) must stamp the open AND write the delivery event the email fallback reads. */
const updates: Array<Record<string, unknown>> = [];
const isCalls: Array<[string, unknown]> = [];
let rpcResult: { error: { message: string } | null } = { error: null };
let rpcArgs: unknown = null;
let user: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };

function chain() {
  const c: Record<string, unknown> = {};
  c.eq = () => c;
  c.is = (col: string, v: unknown) => {
    isCalls.push([col, v]);
    return Promise.resolve({ error: null });
  };
  c.then = (resolve: (v: { error: null }) => void) => resolve({ error: null });
  return c;
}

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => user,
  createClient: async () => ({
    rpc: async (_fn: string, args: unknown) => {
      rpcArgs = args;
      return rpcResult;
    },
    from: () => ({
      update: (u: Record<string, unknown>) => {
        updates.push(u);
        return chain();
      },
    }),
  }),
}));

import { POST } from "./route";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const req = (body: unknown) => new Request("http://x/api/notifications/opened", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  updates.length = 0;
  isCalls.length = 0;
  rpcResult = { error: null };
  rpcArgs = null;
  user = { id: "11111111-1111-4111-8111-111111111111" };
});

describe("POST /api/notifications/opened", () => {
  it("refuses a caller who is not signed in", async () => {
    user = null;
    expect((await POST(req({ notificationId: ID }))).status).toBe(401);
  });
  it("refuses a body that is not a notification id", async () => {
    expect((await POST(req({ notificationId: "x" }))).status).toBe(400);
  });
  it("reports the open through the RPC and only marks the row read", async () => {
    const res = await POST(req({ notificationId: ID }));
    expect(await res.json()).toEqual({ ok: true });
    expect(rpcArgs).toEqual({ p_notification_id: ID });
    expect(updates).toEqual([{ status: "read" }]);
  });
  it("falls back to stamping opened_at itself when the RPC is not there yet", async () => {
    rpcResult = { error: { message: "function not found" } };
    await POST(req({ notificationId: ID }));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ status: "read", opened_at: expect.any(String) });
    expect(isCalls).toEqual([["opened_at", null]]);
  });
});
