/**
 * backfillSignupMetadata's referral-code RPC call can reject on a transport
 * error rather than resolving with { ok:false, error } (the only failure
 * shape its own comment accounts for). Wrapped in runBestEffort (caught in
 * code review while fixing signup/actions.ts's misleading "check your
 * email" copy — see apps/web/src/app/signup/auto-confirm-redirect.test.ts)
 * so a confirmation-link click still completes and redirects the user in,
 * reporting to Sentry instead of surfacing a 500 for what is otherwise a
 * successful email confirmation.
 */

const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const exchangeCodeForSessionMock = jest.fn();
const singleMock = jest.fn().mockResolvedValue({ data: { role: "patient" } });
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { exchangeCodeForSession: (...args: unknown[]) => exchangeCodeForSessionMock(...args) },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single: (...args: unknown[]) => singleMock(...args) }),
      }),
    }),
  }),
}));

const backfillSignupMetadataMock = jest.fn();
jest.mock("@/lib/auth/backfill-signup-metadata", () => ({
  backfillSignupMetadata: (...args: unknown[]) => backfillSignupMetadataMock(...args),
}));

import { GET } from "./route";

function requestFor(url: string) {
  return { url } as Parameters<typeof GET>[0];
}

describe("GET /auth/callback — metadata backfill is best-effort", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset();
    backfillSignupMetadataMock.mockReset();
    captureException.mockClear();
  });

  it("still redirects to the resolved destination when the metadata backfill rejects", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "user-123" } },
      error: null,
    });
    const backfillError = new Error("redeem_referral_code: fetch failed");
    backfillSignupMetadataMock.mockRejectedValue(backfillError);

    // Sabotage check: without runBestEffort wrapping the call, this route
    // would throw here instead of ever reaching NextResponse.redirect.
    const response = await GET(
      requestFor("https://app.tarragonhealth.ng/auth/callback?code=abc123")
    );

    expect(response.headers.get("location")).toBe("https://app.tarragonhealth.ng/patient");
    expect(captureException).toHaveBeenCalledWith(
      backfillError,
      expect.objectContaining({ extra: expect.objectContaining({ userId: "user-123" }) })
    );
  });

  it("redirects normally when the metadata backfill succeeds", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: { id: "user-123" } },
      error: null,
    });
    backfillSignupMetadataMock.mockResolvedValue(undefined);

    const response = await GET(
      requestFor("https://app.tarragonhealth.ng/auth/callback?code=abc123")
    );

    expect(response.headers.get("location")).toBe("https://app.tarragonhealth.ng/patient");
    expect(captureException).not.toHaveBeenCalled();
  });
});
