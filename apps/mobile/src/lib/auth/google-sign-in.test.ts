import {
  callbackParams,
  googleSignInAvailable,
  signInWithGoogle,
  GOOGLE_REDIRECT_URL,
  GOOGLE_SIGN_IN_FAILED,
  type GoogleAuthApi,
} from "./google-sign-in";

function fakeAuth(overrides: Partial<GoogleAuthApi> = {}) {
  const calls: { oauth: unknown[]; setSession: unknown[] } = { oauth: [], setSession: [] };
  const auth: GoogleAuthApi = {
    signInWithOAuth: async (args) => {
      calls.oauth.push(args);
      return { data: { url: "https://example.supabase.co/auth/v1/authorize?provider=google" }, error: null };
    },
    setSession: async (args) => {
      calls.setSession.push(args);
      return { error: null };
    },
    ...overrides,
  };
  return { auth, calls };
}

describe("callbackParams", () => {
  it("reads tokens from the fragment and errors from the query", () => {
    expect(callbackParams(`${GOOGLE_REDIRECT_URL}#access_token=a.b.c&refresh_token=r1&token_type=bearer`)).toMatchObject({
      access_token: "a.b.c",
      refresh_token: "r1",
    });
    expect(callbackParams(`${GOOGLE_REDIRECT_URL}?error=access_denied&error_description=Signups+not+allowed`)).toMatchObject({
      error: "access_denied",
      error_description: "Signups not allowed",
    });
  });
});

describe("signInWithGoogle", () => {
  it("asks Supabase for the URL without redirecting, opens the sheet, and stores the session", async () => {
    const { auth, calls } = fakeAuth();
    const open = jest.fn(async () => ({ type: "success", url: `${GOOGLE_REDIRECT_URL}#access_token=at&refresh_token=rt` }));
    await expect(signInWithGoogle(auth, open)).resolves.toEqual({ kind: "signed_in" });
    expect(calls.oauth).toEqual([
      { provider: "google", options: { redirectTo: GOOGLE_REDIRECT_URL, skipBrowserRedirect: true } },
    ]);
    expect(open).toHaveBeenCalledWith("https://example.supabase.co/auth/v1/authorize?provider=google", GOOGLE_REDIRECT_URL);
    expect(calls.setSession).toEqual([{ access_token: "at", refresh_token: "rt" }]);
  });

  it("treats a closed sheet as cancelled, not an error", async () => {
    const { auth, calls } = fakeAuth();
    await expect(signInWithGoogle(auth, async () => ({ type: "cancel" }))).resolves.toEqual({ kind: "cancelled" });
    expect(calls.setSession).toEqual([]);
  });

  it("reports a refused sign-up (invitation-only) as the plain failure message", async () => {
    const { auth, calls } = fakeAuth();
    const outcome = await signInWithGoogle(auth, async () => ({
      type: "success",
      url: `${GOOGLE_REDIRECT_URL}?error=access_denied&error_description=Signups+not+allowed`,
    }));
    expect(outcome).toEqual({ kind: "error", message: GOOGLE_SIGN_IN_FAILED });
    expect(calls.setSession).toEqual([]);
  });

  it("never opens the browser when Supabase gives no URL, and never throws", async () => {
    const open = jest.fn();
    const { auth } = fakeAuth({ signInWithOAuth: async () => ({ data: null, error: { message: "provider disabled" } }) });
    await expect(signInWithGoogle(auth, open)).resolves.toEqual({ kind: "error", message: GOOGLE_SIGN_IN_FAILED });
    expect(open).not.toHaveBeenCalled();

    const throwing = fakeAuth({ setSession: async () => Promise.reject(new Error("network")) });
    await expect(
      signInWithGoogle(throwing.auth, async () => ({ type: "success", url: `${GOOGLE_REDIRECT_URL}#access_token=a&refresh_token=b` })),
    ).resolves.toEqual({ kind: "error", message: GOOGLE_SIGN_IN_FAILED });
  });
});

describe("googleSignInAvailable", () => {
  const respond = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

  it("is true only when Supabase reports the Google provider on", async () => {
    await expect(googleSignInAvailable("https://x.supabase.co", "anon", respond({ external: { google: true } }))).resolves.toBe(true);
    await expect(googleSignInAvailable("https://x.supabase.co", "anon", respond({ external: { google: false } }))).resolves.toBe(false);
    await expect(googleSignInAvailable("https://x.supabase.co", "anon", respond({}, false))).resolves.toBe(false);
    await expect(googleSignInAvailable(undefined, "anon", respond({ external: { google: true } }))).resolves.toBe(false);
    const broken = (async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    await expect(googleSignInAvailable("https://x.supabase.co", "anon", broken)).resolves.toBe(false);
  });
});
