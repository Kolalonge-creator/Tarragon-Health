/**
 * S44 (spec 2.12): the lab's door. The translation, the CMO-confirmed mapping, the hold rules and the "never say why" rule are the database's
 * (packages/db/tests/s44_interoperability.sql); this proves the route authenticates, validates, maps the database's answer to honest status
 * codes (422 for a rejected push, 403 for a refused lab) and never invents an answer when the database's reply is not what it expects.
 */
const getUser = jest.fn();
const rpc = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) }, rpc: (...a: unknown[]) => rpc(...a) }),
}));

import { POST } from "./route";

const ORDER = "11111111-1111-4111-8111-111111111111";

function req(body: unknown, auth: string | null = "Bearer lab-token"): Request {
  return new Request("https://app.tarragonhealth.ng/api/lab-partner/results/push", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}
const good = { order_id: ORDER, message_id: "msg-000001", items: [{ loinc: "2160-0", value: 0.9, unit: "mg/dL" }] };

describe("POST /api/lab-partner/results/push", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "lab-user" } }, error: null });
    rpc.mockReset();
  });

  it("needs a bearer token and a valid session", async () => {
    expect((await POST(req(good, null))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect((await POST(req(good))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("validates the body before calling the database: a LOINC code must look like one, an order must be an id", async () => {
    expect((await POST(req({ ...good, items: [{ loinc: "creatinine", value: 1, unit: "mg/dL" }] }))).status).toBe(400);
    expect((await POST(req({ ...good, order_id: "not-an-id" }))).status).toBe(400);
    expect((await POST(req({ ...good, items: [] }))).status).toBe(400);
    expect((await POST(req({ ...good, message_id: "x" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the order, the lab's own message id and the items through, and answers 200 received with only out-or-held", async () => {
    rpc.mockResolvedValue({ data: { status: "received", state: "held" }, error: null });
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lab_partner_push_result", { p_order: ORDER, p_message_id: "msg-000001", p_items: good.items });
    expect(await res.json()).toEqual({ status: "received", state: "held" });
  });

  it("answers 422 with the unmapped pairs when the database rejects the push", async () => {
    rpc.mockResolvedValue({ data: { status: "rejected", reject_code: "unmapped_item", unmapped: [{ loinc: "2160-0", unit: "umol/L" }] }, error: null });
    const res = await POST(req(good));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ status: "rejected", reject_code: "unmapped_item", unmapped: [{ loinc: "2160-0", unit: "umol/L" }] });
  });

  it("answers 403 the same way for a user who is not a lab and for an order that is not this lab's", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Order not found for this lab" } });
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not permitted" });
  });

  it("never forwards a reply it does not recognise", async () => {
    rpc.mockResolvedValue({ data: { status: "released_because_critical" }, error: null });
    expect((await POST(req(good))).status).toBe(500);
  });
});
