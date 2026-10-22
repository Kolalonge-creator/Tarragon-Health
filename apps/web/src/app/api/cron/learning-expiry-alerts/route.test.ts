/**
 * The learning content expiry alerts job. Proves: refused without the cron secret (and the database function is never called); runs the one
 * database function with no arguments; passes its counts through; a failed run answers 500 so it is seen; and the job is scheduled once a day
 * in vercel.json (nothing sub-daily: Vercel blocks a deploy on a more frequent cron on this plan).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let result: { data: unknown; error: { message: string } | null } = { data: { owner_notices: 1, cmo_digests: 1 }, error: null };
const rpc = jest.fn(async (...args: unknown[]) => {
  void args;
  return result;
});
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));

import { GET } from "./route";

const req = (secret?: string) =>
  new Request("https://x.test/api/cron/learning-expiry-alerts", { headers: secret ? { authorization: `Bearer ${secret}` } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  result = { data: { owner_notices: 1, cmo_digests: 1 }, error: null };
  jest.clearAllMocks();
});

describe("learning expiry alerts cron", () => {
  it("refuses a request without the secret and touches nothing", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("wrong"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses everything when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("anything"))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("runs the database function once and returns its counts", async () => {
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ owner_notices: 1, cmo_digests: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("learning_expiry_run_alerts", {});
  });

  it("answers 500 when the run fails, so a broken run is seen", async () => {
    result = { data: null, error: { message: "boom" } };
    const res = await GET(req("s3cret"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("learning_expiry_alerts_failed");
  });

  it("is scheduled exactly once, daily (five-field cron with a fixed minute and hour, never sub-daily)", () => {
    const cfg = JSON.parse(readFileSync(join(__dirname, "../../../../../vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    const mine = cfg.crons.filter((c) => c.path === "/api/cron/learning-expiry-alerts");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});
