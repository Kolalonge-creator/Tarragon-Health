import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";

const rpc = jest.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));

import { GET } from "./route";

const SECRET = "s".repeat(32);
const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/health/deadman", { headers });
const good = { process_events_heartbeat_age_seconds: 12, due_unclaimed_deliveries: 0, dead_letter_deliveries: 0, open_sev1_sev2_incidents: 0 };

describe("GET /api/health/deadman", () => {
  const saved = process.env.HEALTH_CHECK_SECRET;
  beforeEach(() => {
    rpc.mockReset();
    process.env.HEALTH_CHECK_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.HEALTH_CHECK_SECRET;
    else process.env.HEALTH_CHECK_SECRET = saved;
  });

  it("no secret configured: 503 and reads nothing (fails closed)", async () => {
    delete process.env.HEALTH_CHECK_SECRET;
    expect((await GET(req({ "x-health-secret": SECRET }))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("no secret presented: 401 and reads nothing", async () => {
    expect((await GET(req())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("wrong secret: 401 and reads nothing", async () => {
    expect((await GET(req({ "x-health-secret": "w".repeat(32) }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("right secret, healthy: 200 ok with counts and ages only", async () => {
    rpc.mockResolvedValue({ data: good, error: null });
    const res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("ok");
    expect(body.status).toEqual(good);
    expect(rpc).toHaveBeenCalledWith("deadman_status", { p_due_older_than_seconds: expect.any(Number) });
  });
  it("a bearer token also works", async () => {
    rpc.mockResolvedValue({ data: good, error: null });
    expect((await GET(req({ authorization: `Bearer ${SECRET}` }))).status).toBe(200);
  });
  it("stale heartbeat: 503 down", async () => {
    rpc.mockResolvedValue({ data: { ...good, process_events_heartbeat_age_seconds: 99999 }, error: null });
    const res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).verdict).toBe("down");
  });
  it("degraded still answers 200", async () => {
    rpc.mockResolvedValue({ data: { ...good, dead_letter_deliveries: 1 }, error: null });
    const res = await GET(req({ "x-health-secret": SECRET }));
    expect(res.status).toBe(200);
    expect((await res.json()).verdict).toBe("degraded");
  });
  it("rpc error, malformed payload or thrown: 503, never ok", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await GET(req({ "x-health-secret": SECRET }))).status).toBe(503);
    rpc.mockResolvedValueOnce({ data: { nope: 1 }, error: null });
    expect((await GET(req({ "x-health-secret": SECRET }))).status).toBe(503);
    rpc.mockRejectedValueOnce(new Error("net"));
    expect((await GET(req({ "x-health-secret": SECRET }))).status).toBe(503);
  });
});
