/**
 * @jest-environment node
 *
 * Security audit 2026-11-05, M-8: /api/track takes anonymous writes through the service role, so it is capped per source IP.
 */
const limitMock = jest.fn();
jest.mock("@/lib/security/abuse-limits", () => ({ checkAbuseLimit: (...a: unknown[]) => limitMock(...a) }));
jest.mock("@/lib/rate-limit", () => ({ getClientIp: jest.fn().mockResolvedValue("203.0.113.9") }));
const insertMock = jest.fn().mockResolvedValue({ error: null });
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from: () => ({ insert: insertMock }) }) }));
jest.mock("@/lib/supabase/server", () => ({ getCurrentUser: jest.fn().mockResolvedValue(null) }));

import { POST } from "./route";

const beacon = () => new Request("https://app.example/api/track", { method: "POST", body: JSON.stringify({ path: "/" }) });

beforeEach(() => {
  limitMock.mockReset();
  insertMock.mockClear();
});

it("records a page view under the limit, keyed by the source IP", async () => {
  limitMock.mockResolvedValue({ ok: true });
  const res = await POST(beacon());
  expect(res.status).toBe(200);
  expect(limitMock).toHaveBeenCalledWith("page_view", "203.0.113.9");
  expect(insertMock).toHaveBeenCalledTimes(1);
});

it("refuses with 429 and writes nothing over the limit", async () => {
  limitMock.mockResolvedValue({ ok: false, retryAfterSeconds: 42 });
  const res = await POST(beacon());
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("42");
  expect(insertMock).not.toHaveBeenCalled();
});
