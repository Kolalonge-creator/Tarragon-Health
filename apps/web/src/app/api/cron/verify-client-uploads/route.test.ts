/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): the sweep that checks files clients wrote straight to Storage. Only the cron secret
 * may run it, from pg_cron (POST) or Vercel cron (GET); a failed claim is a 500, never a silent success.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const run = jest.fn<() => Promise<unknown>>();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
jest.mock("@/lib/uploads/verify-stored-upload", () => ({ runClientUploadChecks: () => run() }));

import { GET, POST } from "./route";

const none = { clean: 0, cleaned: 0, quarantined: 0, gone: 0, error: 0 };
const req = (auth?: string, method = "GET") => new Request("https://app.example/api/cron/verify-client-uploads", { method, headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  run.mockReset();
});

describe("verify-client-uploads cron", () => {
  it("refuses a call without the cron secret", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await POST(req("Bearer wrong", "POST"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs batches until one comes back short, and adds up the outcomes", async () => {
    run.mockResolvedValueOnce({ checked: 10, outcomes: { ...none, clean: 9, quarantined: 1 } }).mockResolvedValueOnce({ checked: 2, outcomes: { ...none, cleaned: 2 } });
    const res = await POST(req("Bearer s3cret", "POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 12, totals: { ...none, clean: 9, quarantined: 1, cleaned: 2 } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a failed claim is a 500", async () => {
    run.mockResolvedValue({ error: "boom" });
    expect((await GET(req("Bearer s3cret"))).status).toBe(500);
  });
});
