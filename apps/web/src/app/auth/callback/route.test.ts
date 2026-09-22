/**
 * Regression: /auth/callback (magic-link/email-confirmation sign-in) never
 * stamped the idle-timeout activity cookie. /auth/* is itself idle-timeout-
 * exempt (proxy.ts), so a user with a stale cookie from a previous session
 * who signs in via a magic link was redirected straight into a non-exempt
 * page and immediately bounced to /login?reason=idle right after a
 * successful sign-in. Proves the redirect response now carries a fresh
 * th_last_seen cookie.
 */

const exchangeCodeForSession = jest.fn();
const profilesUpdate = jest.fn().mockReturnValue({ eq: jest.fn() });
const profilesSingle = jest.fn().mockResolvedValue({ data: { role: "patient" } });
const rpc = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { exchangeCodeForSession },
    from: () => ({
      update: profilesUpdate,
      select: () => ({ eq: () => ({ single: profilesSingle }) }),
    }),
    rpc,
  }),
}));

import { GET } from "./route";
import { LAST_ACTIVITY_COOKIE } from "@/lib/auth/idle-timeout";

function callbackRequest(code: string) {
  return new Request(`https://app.tarragonhealth.ng/auth/callback?code=${code}`);
}

beforeEach(() => {
  exchangeCodeForSession.mockReset();
});

describe("GET /auth/callback — stale-cookie regression", () => {
  it("stamps a fresh activity cookie on a successful code exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: "user-1", user_metadata: {} } },
      error: null,
    });

    const response = await GET(callbackRequest("real-code") as never);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${LAST_ACTIVITY_COOKIE}=`);
  });

  it("does NOT stamp when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "bad code" } });

    const response = await GET(callbackRequest("bad-code") as never);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain(`${LAST_ACTIVITY_COOKIE}=`);
  });
});
