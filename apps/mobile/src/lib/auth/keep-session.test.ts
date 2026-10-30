import type { Session } from "@supabase/supabase-js";
import { keepSessionIfSame } from "./keep-session";

function session(userId: string, token: string, expiresAt = 1): Session {
  return { access_token: token, refresh_token: "r", expires_in: 3600, expires_at: expiresAt, token_type: "bearer", user: { id: userId } } as unknown as Session;
}

describe("keepSessionIfSame", () => {
  it("keeps the previous object when the same person re-emits the same token", () => {
    const previous = session("u1", "t1");
    expect(keepSessionIfSame(previous, session("u1", "t1", 99))).toBe(previous);
  });

  it("takes the new object when the access token changed (a real refresh)", () => {
    const next = session("u1", "t2");
    expect(keepSessionIfSame(session("u1", "t1"), next)).toBe(next);
  });

  it("takes the new object for a different person on the same token value", () => {
    const next = session("u2", "t1");
    expect(keepSessionIfSame(session("u1", "t1"), next)).toBe(next);
  });

  it("follows sign-out and the first session", () => {
    expect(keepSessionIfSame(session("u1", "t1"), null)).toBeNull();
    const first = session("u1", "t1");
    expect(keepSessionIfSame(undefined, first)).toBe(first);
    expect(keepSessionIfSame(null, first)).toBe(first);
  });
});
