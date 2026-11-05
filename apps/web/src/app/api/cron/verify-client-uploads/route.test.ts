/**
 * @jest-environment node
 *
 * Security audit 2026-11-05 (M-4/L-4): the sweep that checks files clients wrote straight to Storage. Vercel cron runs it with
 * the cron secret; pg_cron runs it with a one-time code the database made, spent through consume_client_upload_check_kick. A
 * failed claim is a 500, never a silent success.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const run = jest.fn<() => Promise<unknown>>();
const consume = jest.fn<(fn: string, args: { p_code: string }) => Promise<{ data: boolean | null; error: { message: string } | null }>>();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (fn: string, args: { p_code: string }) => consume(fn, args) }) }));
jest.mock("@/lib/uploads/verify-stored-upload", () => ({ runClientUploadChecks: () => run() }));

import { GET, POST } from "./route";

const none = { clean: 0, cleaned: 0, quarantined: 0, gone: 0, error: 0 };
const req = (auth?: string, method = "GET") => new Request("https://app.example/api/cron/verify-client-uploads", { method, headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  run.mockReset();
  consume.mockReset();
  consume.mockResolvedValue({ data: false, error: null });
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

  it("runs for pg_cron's one-time code, spending it through the server-only function", async () => {
    consume.mockResolvedValue({ data: true, error: null });
    run.mockResolvedValue({ checked: 0, outcomes: none });
    const code = "8f14e45f-ceea-4e67-a6e7-1b2c3d4e5f60";
    const res = await POST(new Request("https://app.example/api/cron/verify-client-uploads", { method: "POST", headers: { "x-upload-check-kick": code } }));
    expect(res.status).toBe(200);
    expect(consume).toHaveBeenCalledWith("consume_client_upload_check_kick", { p_code: code });
  });

  it("refuses a spent, unknown or expired code, and a lookup error", async () => {
    const code = "8f14e45f-ceea-4e67-a6e7-1b2c3d4e5f60";
    const call = () => POST(new Request("https://app.example/api/cron/verify-client-uploads", { method: "POST", headers: { "x-upload-check-kick": code } }));
    consume.mockResolvedValue({ data: false, error: null });
    expect((await call()).status).toBe(401);
    consume.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await call()).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("never asks the database about a header that is not a code", async () => {
    const res = await POST(new Request("https://app.example/api/cron/verify-client-uploads", { method: "POST", headers: { "x-upload-check-kick": "'; drop table x;--" } }));
    expect(res.status).toBe(401);
    expect(consume).not.toHaveBeenCalled();
  });
});
