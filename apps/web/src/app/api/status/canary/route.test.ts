import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const rpc = jest.fn<(name: string) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));
const limit = jest.fn<() => Promise<{ success: boolean }>>();
jest.mock("@/lib/rate-limit", () => ({ getClientIp: async () => "1.2.3.4", rateLimit: () => limit() }));

import { GET } from "./route";

describe("GET /api/status/canary", () => {
  beforeEach(() => { rpc.mockReset(); limit.mockReset(); limit.mockResolvedValue({ success: true }); });

  it("fresh: 200 and exactly {ok, age_bucket}", async () => {
    rpc.mockResolvedValue({ data: { ok: true, age_bucket: "under_1h", secret: "x", last: "2026-10-16T00:00:00Z" }, error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, age_bucket: "under_1h" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledWith("canary_heartbeat");
  });
  it("stale: 503 with the bucket so the monitor alerts", async () => {
    rpc.mockResolvedValue({ data: { ok: false, age_bucket: "3h_to_24h" }, error: null });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, age_bucket: "3h_to_24h" });
  });
  it("cannot tell (error, odd shape, unknown bucket, thrown): 503, never ok", async () => {
    for (const r of [{ data: null, error: { message: "db down" } }, { data: { ok: "yes" }, error: null }, { data: { ok: true, age_bucket: "yesterday" }, error: null }]) {
      rpc.mockResolvedValueOnce(r);
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, age_bucket: "unknown" });
    }
    rpc.mockRejectedValueOnce(new Error("network"));
    expect((await GET()).status).toBe(503);
  });
  it("rate limited: 429 and no database call", async () => {
    limit.mockResolvedValue({ success: false });
    expect((await GET()).status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });
});
