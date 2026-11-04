/**
 * A Google sign-in that does not finish comes back to /auth/callback with ?error=... and no code: the person cancelled at Google,
 * or the database refused the new account (the invite-only trigger on auth.users). The route must send them to /login with the
 * explanation flag, not to a bare form that looks like nothing happened.
 */
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/auth/backfill-signup-metadata", () => ({ backfillSignupMetadata: jest.fn() }));

import { GET } from "./route";

const requestFor = (url: string) => ({ url }) as Parameters<typeof GET>[0];

describe("GET /auth/callback without a code", () => {
  it("flags a failed Google sign-in for /login", async () => {
    const res = await GET(requestFor("https://app.tarragonhealth.ng/auth/callback?via=google&error=server_error&error_description=Database+error+saving+new+user"));
    expect(res.headers.get("location")).toBe("https://app.tarragonhealth.ng/login?error=google");
  });

  it("does not blame Google for an expired email link", async () => {
    const res = await GET(requestFor("https://app.tarragonhealth.ng/auth/callback?error=access_denied&error_code=otp_expired"));
    expect(res.headers.get("location")).toBe("https://app.tarragonhealth.ng/login");
  });

  it("keeps the plain /login redirect when there is neither a code nor an error", async () => {
    const res = await GET(requestFor("https://app.tarragonhealth.ng/auth/callback"));
    expect(res.headers.get("location")).toBe("https://app.tarragonhealth.ng/login");
  });
});
