/**
 * SyncOutcome.safetyAssessmentFailed is accumulated across every connection
 * in a sweep with `totals.safetyAssessmentFailed ||= outcome.safetyAssessmentFailed`
 * — this is the one call site touched by that change with no dedicated test
 * of its own (every other call site got a *-safety-assessment-failure.test.ts).
 * It matters here specifically because a connection whose post-insert
 * red-flag assessment failed does NOT get marked in `last_sync_error` (that
 * column only reflects genuine storage failures — see sync.ts's ingestFor),
 * so this sweep's own response is the only place that failure surfaces at
 * all; a regression here (e.g. a future switch to `Promise.all` that drops
 * or races the accumulation) would make it disappear silently.
 */

const pullConnection = jest.fn();
jest.mock("@/lib/wearables/sync", () => ({
  pullConnection: (...args: unknown[]) => pullConnection(...args),
}));

const select = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        in: () => ({
          eq: () => select(),
        }),
      }),
    }),
  }),
}));

import { GET } from "./route";

function request(): Request {
  return new Request("https://app.tarragonhealth.ng/api/cron/wearable-sync", {
    headers: { authorization: "Bearer test-cron-secret" },
  });
}

function emptyOutcome(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    connectionsTouched: 1,
    vitalsInserted: 0,
    wearableInserted: 0,
    implausible: 0,
    unmatchedAccounts: 0,
    deniedByConsent: 0,
    consentDeniedSafetyRetained: 0,
    failed: 0,
    safetyAssessmentFailed: false,
    ...overrides,
  };
}

describe("GET /api/cron/wearable-sync — safetyAssessmentFailed accumulation", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeAll(() => {
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterAll(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  beforeEach(() => {
    pullConnection.mockReset();
    select.mockReset();
  });

  it("stays true for the whole sweep once any one connection reports it, even if a later connection reports false", async () => {
    select.mockResolvedValue({
      data: [
        { id: "conn-1", sync_cursor: null },
        { id: "conn-2", sync_cursor: null },
      ],
      error: null,
    });
    pullConnection
      .mockResolvedValueOnce(emptyOutcome({ safetyAssessmentFailed: true }))
      .mockResolvedValueOnce(emptyOutcome({ safetyAssessmentFailed: false }));

    const res = await GET(request());
    const body = (await res.json()) as { safetyAssessmentFailed: boolean };

    expect(body.safetyAssessmentFailed).toBe(true);
  });

  it("stays false when no connection reports a safety-assessment failure", async () => {
    select.mockResolvedValue({
      data: [{ id: "conn-1", sync_cursor: null }],
      error: null,
    });
    pullConnection.mockResolvedValueOnce(emptyOutcome({ safetyAssessmentFailed: false }));

    const res = await GET(request());
    const body = (await res.json()) as { safetyAssessmentFailed: boolean };

    expect(body.safetyAssessmentFailed).toBe(false);
  });
});
