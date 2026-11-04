/**
 * "Continue with Google" on the phone, through Supabase's Google provider and the system browser sheet
 * (ASWebAuthenticationSession on iOS, Custom Tabs on Android). Google refuses sign-in inside an embedded web view, and
 * the system sheet is what it accepts. No native Google SDK: this is JavaScript only, so it ships without a new build.
 *
 * The client uses Supabase's default (implicit) flow, so the browser comes back to tarragonhealth://auth/callback with
 * the session in the URL fragment and we hand it to setSession. PKCE is deliberately NOT switched on for the whole
 * client: the email password-reset link (forgot-password-screen) would then need a verifier stored on the phone.
 *
 * The button shows only while the Google provider is switched on in Supabase (GET /auth/v1/settings), the same gate the
 * web uses: no platform switch of our own. Nothing here logs; a token must never reach console, Sentry or analytics.
 */

/** Must be listed in Supabase Auth > URL Configuration > Redirect URLs. The scheme is app.json's `scheme`. */
export const GOOGLE_REDIRECT_URL = "tarragonhealth://auth/callback";

export interface GoogleAuthApi {
  signInWithOAuth(args: {
    provider: "google";
    options: { redirectTo: string; skipBrowserRedirect: true };
  }): Promise<{ data: { url: string | null } | null; error: { message: string } | null }>;
  setSession(args: { access_token: string; refresh_token: string }): Promise<{ error: { message: string } | null }>;
}

export type BrowserResult = { type: "success"; url: string } | { type: string };

export type OpenAuthSession = (url: string, redirectUrl: string) => Promise<BrowserResult>;

export type GoogleSignInOutcome =
  | { kind: "signed_in" }
  /** The person closed the sheet. Not an error: show nothing. */
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export const GOOGLE_SIGN_IN_FAILED =
  "Google sign-in did not finish. If you are new to Tarragon and sign-up is by invitation at the moment, you need an invitation first. Otherwise, try again or sign in another way.";

/** Read key=value pairs from both the query and the fragment of the callback URL. */
export function callbackParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const queryStart = url.indexOf("?");
  const hashStart = url.indexOf("#");
  const parts: string[] = [];
  if (queryStart >= 0) parts.push(url.slice(queryStart + 1, hashStart > queryStart ? hashStart : undefined));
  if (hashStart >= 0) parts.push(url.slice(hashStart + 1));
  for (const part of parts) {
    for (const pair of part.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const key = decodeURIComponent((eq >= 0 ? pair.slice(0, eq) : pair).replace(/\+/g, " "));
      const value = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " ")) : "";
      if (key) out[key] = value;
    }
  }
  return out;
}

export async function signInWithGoogle(auth: GoogleAuthApi, openAuthSession: OpenAuthSession): Promise<GoogleSignInOutcome> {
  let url: string | null = null;
  try {
    const { data, error } = await auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: GOOGLE_REDIRECT_URL, skipBrowserRedirect: true },
    });
    if (error || !data?.url) return { kind: "error", message: GOOGLE_SIGN_IN_FAILED };
    url = data.url;
  } catch {
    return { kind: "error", message: GOOGLE_SIGN_IN_FAILED };
  }

  let result: BrowserResult;
  try {
    result = await openAuthSession(url, GOOGLE_REDIRECT_URL);
  } catch {
    return { kind: "error", message: GOOGLE_SIGN_IN_FAILED };
  }
  if (result.type !== "success" || !("url" in result)) return { kind: "cancelled" };

  const params = callbackParams(result.url);
  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;
  if (params.error || !accessToken || !refreshToken) return { kind: "error", message: GOOGLE_SIGN_IN_FAILED };

  try {
    const { error } = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) return { kind: "error", message: GOOGLE_SIGN_IN_FAILED };
  } catch {
    return { kind: "error", message: GOOGLE_SIGN_IN_FAILED };
  }
  return { kind: "signed_in" };
}

/** Is the Google provider switched on in Supabase? Never throws; any failure hides the button. */
export async function googleSignInAvailable(
  supabaseUrl: string | undefined,
  anonKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!supabaseUrl || !anonKey) return false;
  try {
    const res = await fetchImpl(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return false;
    const external = (body as { external?: unknown }).external;
    if (typeof external !== "object" || external === null) return false;
    return (external as { google?: unknown }).google === true;
  } catch {
    return false;
  }
}
