/** @jest-environment node */
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = jest.fn<Rpc>();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));

import { GET } from "./route";

const authorised = new Request("http://localhost/x", { headers: { authorization: "Bearer s3cret" } });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  rpc.mockReset();
});

describe("community overdue check", () => {
  it("refuses a caller without the secret and reports nothing", async () => {
    expect((await GET(new Request("http://localhost/x"))).status).toBe(401);
    expect((await GET(new Request("http://localhost/x", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses everything when the secret is not configured at all", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(new Request("http://localhost/x", { headers: { authorization: "Bearer undefined" } }))).status).toBe(401);
  });

  it("sends the notices and reports a successful run", async () => {
    rpc.mockImplementation(async (fn) => {
      if (fn === "community_overdue_work") return { data: { safety_overdue: 1, queue_overdue: 0, appeals_overdue: 0 }, error: null };
      if (fn === "community_notify_overdue") return { data: 3, error: null };
      return { data: null, error: null };
    });
    const res = await GET(authorised);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ notified: 3 });
    expect(rpc).toHaveBeenLastCalledWith("community_job_heartbeat", { p_job: "overdue", p_ok: true });
  });

  it("records a failed run as failed when the work cannot be read", async () => {
    rpc.mockImplementation(async (fn) => (fn === "community_overdue_work" ? { data: null, error: { message: "boom" } } : { data: null, error: null }));
    const res = await GET(authorised);
    expect(res.status).toBe(500);
    expect(rpc).toHaveBeenLastCalledWith("community_job_heartbeat", { p_job: "overdue", p_ok: false });
    expect(rpc).not.toHaveBeenCalledWith("community_notify_overdue");
  });

  it("records a failed run as failed when the notices cannot be sent", async () => {
    rpc.mockImplementation(async (fn) => {
      if (fn === "community_overdue_work") return { data: {}, error: null };
      if (fn === "community_notify_overdue") return { data: null, error: { message: "boom" } };
      return { data: null, error: null };
    });
    expect((await GET(authorised)).status).toBe(500);
    expect(rpc).toHaveBeenLastCalledWith("community_job_heartbeat", { p_job: "overdue", p_ok: false });
  });
});
