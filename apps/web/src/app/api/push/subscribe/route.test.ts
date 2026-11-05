/**
 * Regression test (assessment S8, 2026-11-05): the sender disables a web push subscription the push service will never accept again
 * (gone, or made with a rotated VAPID key). The subscribe route used to upsert disabled_at = null for the same endpoint, so a device
 * that re-posted its dead subscription silently re-enabled it and never subscribed afresh. Now it is told to resubscribe instead.
 */

let existingRow: { disabled_at: string | null } | null = null;
const upsert = jest.fn(async () => ({ error: null }));

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: jest.fn(async () => ({ id: "user-1" })),
  createClient: jest.fn(async () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) }),
        upsert,
      };
    },
  })),
}));

import { POST } from "./route";

function request(): Request {
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: "https://push.example.com/abc", keys: { p256dh: "p", auth: "a" } }),
  });
}

describe("POST /api/push/subscribe", () => {
  beforeEach(() => upsert.mockClear());

  it("stores a new subscription", async () => {
    existingRow = null;
    const body = await (await POST(request())).json();
    expect(body).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("re-saves an active subscription", async () => {
    existingRow = { disabled_at: null };
    const body = await (await POST(request())).json();
    expect(body).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("does not re-enable a subscription the sender disabled, and asks the device to resubscribe", async () => {
    existingRow = { disabled_at: "2026-11-05T10:00:00Z" };
    const body = await (await POST(request())).json();
    expect(body.ok).toBe(false);
    expect(body.resubscribe).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });
});
