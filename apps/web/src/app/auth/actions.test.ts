/**
 * Regression: signOut() used to leave the idle-timeout activity cookie
 * (th_last_seen) in place. Because proxy.ts's idle-timeout check runs on the
 * sign-out request itself (the caller is still authenticated for it), that
 * left a freshly-stamped "now" cookie behind with maxAge outliving the idle
 * threshold by a minute — so logging back in 30-31 minutes after signing out
 * found the stale cookie already reading as idle-expired, bouncing a fresh,
 * valid sign-in straight back to /login?reason=idle. Proves signOut() now
 * deletes th_last_seen.
 */

jest.mock("next/navigation", () => ({ redirect: jest.fn() }));

const cookieDelete = jest.fn();
jest.mock("next/headers", () => ({
  cookies: jest.fn().mockResolvedValue({ delete: cookieDelete }),
}));

const authSignOut = jest.fn().mockResolvedValue({ error: null });
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ auth: { signOut: authSignOut } }),
}));

import { signOut } from "./actions";
import { LAST_ACTIVITY_COOKIE } from "@/lib/auth/idle-timeout";

describe("signOut", () => {
  it("deletes the idle-timeout activity cookie, not just the Supabase session", async () => {
    await signOut();

    expect(authSignOut).toHaveBeenCalled();
    expect(cookieDelete).toHaveBeenCalledWith(LAST_ACTIVITY_COOKIE);
  });
});
