import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const getCurrentUser = jest.fn<() => Promise<{ id: string } | null>>();
const fdRpcData = jest.fn<(s: unknown, fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: string | null }>>();
const rateLimit = jest.fn<(k: string, r: unknown) => Promise<{ success: boolean; retryAfterSeconds: number }>>();
jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase/server", () => ({ getCurrentUser: () => getCurrentUser() }));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
jest.mock("@/lib/frontdesk/raw-db", () => ({ fdRpcData: (s: unknown, fn: string, a: Record<string, unknown>) => fdRpcData(s, fn, a) }));
jest.mock("@/lib/rate-limit", () => ({ rateLimit: (k: string, r: unknown) => rateLimit(k, r) }));

import { POST } from "./route";

const post = (body: unknown) => new Request("https://app.tarragonhealth.ng/api/frontdesk/events", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  jest.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1" });
  rateLimit.mockResolvedValue({ success: true, retryAfterSeconds: 0 });
  fdRpcData.mockResolvedValue({ data: { recorded: true }, error: null });
});

describe("funnel events route", () => {
  it("requires a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect((await POST(post({ type: "pricing_viewed" }))).status).toBe(401);
    expect(fdRpcData).not.toHaveBeenCalled();
  });

  it("records an accepted event for the SESSION user, ignoring any user id in the body", async () => {
    const res = await POST(post({ type: "checkout_started", user: "someone-else", p_user: "someone-else" }));
    expect(res.status).toBe(204);
    expect(fdRpcData).toHaveBeenCalledWith(expect.anything(), "service_fd_record_event", { p_user: "user-1", p_type: "checkout_started", p_step: null, p_key: null });
  });

  it("refuses event types that are derived on the server (paid, onboarding_completed) and unknown ones", async () => {
    for (const type of ["paid", "onboarding_completed", "account_created", "risk_check_done", "made_up"]) {
      expect((await POST(post({ type }))).status).toBe(400);
    }
    expect(fdRpcData).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    expect((await POST(new Request("https://x.invalid", { method: "POST", body: "not json" }))).status).toBe(400);
  });

  it("is rate limited", async () => {
    rateLimit.mockResolvedValue({ success: false, retryAfterSeconds: 5 });
    expect((await POST(post({ type: "pricing_viewed" }))).status).toBe(429);
  });

  it("reports a recording failure without detail", async () => {
    fdRpcData.mockResolvedValue({ data: null, error: "boom" });
    const res = await POST(post({ type: "pricing_viewed" }));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("");
  });
});
