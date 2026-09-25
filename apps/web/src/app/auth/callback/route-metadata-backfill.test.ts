/**
 * /auth/callback calls backfillSignupMetadata() (phone/state/account_purpose
 * backfill, referral-code redemption) once a real confirmation-link session
 * exists, tagging its Sentry report "authCallback" if that ever fails.
 * backfillSignupMetadata's own never-throw guarantee (it can't turn a real
 * confirmation into a 500) is tested directly in
 * lib/auth/backfill-signup-metadata.test.ts, including its sabotage case —
 * this file only has to confirm the route wires the call correctly.
 */

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

const backfillSignupMetadataMock = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/auth/backfill-signup-metadata", () => ({
  backfillSignupMetadata: (...args: unknown[]) => backfillSignupMetadataMock(...args),
}));

import { GET } from "./route";

function requestFor(url: string) {
  return { url } as Parameters<typeof GET>[0];
}

describe("GET /auth/callback — metadata backfill wiring", () => {
  beforeEach(() => {
    exchangeCodeForSessionMock.mockReset();
    backfillSignupMetadataMock.mockReset().mockResolvedValue(undefined);
  });

  it("backfills signup metadata tagged 'authCallback' and redirects to the resolved destination", async () => {
    const user = { id: "user-123" };
    exchangeCodeForSessionMock.mockResolvedValue({ data: { user }, error: null });

    const response = await GET(
      requestFor("https://app.tarragonhealth.ng/auth/callback?code=abc123")
    );

    expect(backfillSignupMetadataMock).toHaveBeenCalledWith(
      expect.anything(),
      user,
      "authCallback"
    );
    expect(response.headers.get("location")).toBe("https://app.tarragonhealth.ng/patient");
  });

  it("redirects to /login without calling the backfill when the code exchange fails", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({
      data: { user: null },
      error: new Error("invalid code"),
    });

    const response = await GET(
      requestFor("https://app.tarragonhealth.ng/auth/callback?code=bad-code")
    );

    expect(backfillSignupMetadataMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.tarragonhealth.ng/login");
  });
});
