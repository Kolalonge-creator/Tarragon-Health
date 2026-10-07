/**
 * Review round (S52, 7.9): a mobile report is about ONE answer. It must carry the id of that answer, the answer must be the caller's own, and
 * it is never defaulted to the latest turn.
 */
import { describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn(async (..._args: unknown[]) => ({ data: "incident", error: null }));
let ownsAnswer = true;
const client = {
  auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) },
  rpc,
  from: () => {
    const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: ownsAnswer ? { id: "t1" } : null, error: null }) };
    return q;
  },
};
jest.mock("@/lib/supabase/bearer", () => ({ createBearerClient: () => client }));

import { POST } from "./route";

const ID = "7b1a6f2e-6f0d-4e8e-9f55-0c6a3b2f9c11";
const req = (body: unknown) =>
  new Request("http://x/api", { method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body) });
const base = { category: "incorrect_information", description: "It told me something wrong." };

describe("mobile report-an-answer", () => {
  it("refuses a report with no answer id and files nothing", async () => {
    rpc.mockClear();
    const res = await POST(req(base));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an explicit null id", async () => {
    rpc.mockClear();
    expect((await POST(req({ ...base, interactionId: null }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an answer that is not the caller's own", async () => {
    ownsAnswer = false;
    rpc.mockClear();
    expect((await POST(req({ ...base, interactionId: ID }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("files the report against exactly the answer named", async () => {
    ownsAnswer = true;
    rpc.mockClear();
    expect((await POST(req({ ...base, interactionId: ID }))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("report_ai_safety_incident", expect.objectContaining({ p_interaction_id: ID }));
  });
});
