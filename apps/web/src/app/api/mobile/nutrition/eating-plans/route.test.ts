import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const load = jest.fn<() => Promise<unknown>>();
jest.mock("@/lib/nutrition/eating-plans", () => ({ loadEatingGuidance: () => load() }));
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) } }),
}));

import { GET } from "./route";

const req = (auth?: string) => new Request("http://x/api/mobile/nutrition/eating-plans", { headers: auth ? { authorization: auth } : {} });

describe("GET /api/mobile/nutrition/eating-plans", () => {
  beforeEach(() => {
    load.mockReset();
  });

  it("refuses a request with no token", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("sends the database answer untouched (snake_case), which is what the phone parses", async () => {
    const raw = { state: "ok", config_version: 1, swaps: [], plans: [{ code: "weight" }] };
    load.mockResolvedValue({ signed: true, guidance: { state: "ok" }, raw, failed: false });
    const res = await GET(req("Bearer t"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(raw);
  });

  it("sends the bare unavailable answer as a 200", async () => {
    load.mockResolvedValue({ signed: true, guidance: { state: "unavailable" }, raw: { state: "unavailable" }, failed: false });
    const res = await GET(req("Bearer t"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "unavailable" });
  });

  it("answers a database failure with 503, never with an unavailable the phone would believe", async () => {
    load.mockResolvedValue({ signed: true, guidance: { state: "unavailable" }, raw: null, failed: true });
    const res = await GET(req("Bearer t"));
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty("state");
  });
});
