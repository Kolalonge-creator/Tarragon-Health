import { cookies, headers } from "next/headers";

/**
 * The token the Expo app appends to its WebView User-Agent
 * (apps/mobile/src/screens/webview-screen.tsx). Keep the two in sync.
 */
export const EMBEDDED_UA_TOKEN = "TarragonHealthApp";

/**
 * Set client-side by mobile-bridge-gate.tsx on every bridged load, as a
 * second, UA-independent signal that this browser context is the app's
 * WebView. Android's WebView does not reliably apply a custom
 * `applicationNameForUserAgent` before the very first navigation each time a
 * WebView is (re)created — react-native-webview sets it as a native view
 * property, and on Android that can lose the race against the initial
 * `loadUrl`, so the request the patient actually lands on sometimes goes out
 * with a plain Chrome UA. That intermittently showed the patient double
 * chrome (two headers, two Home/Vitals/Meds/Messages/More tab bars) on
 * whichever WebView section happened to hit the race, not any one page in
 * particular. The cookie has no such race: it is written by a script already
 * running in the WebView, so it exists before the next real navigation fires,
 * and (like the Supabase auth cookie next to it) survives every later
 * WebView open via the shared cookie jar.
 */
export const EMBEDDED_APP_COOKIE = "embedded_app";

/**
 * True when this request is being rendered inside the native app's WebView
 * rather than in a browser.
 *
 * The app embeds real platform pages for the sections it has no native screen
 * for, and it draws its own top bar and bottom tab bar around them. Without
 * this the patient got both sets of chrome stacked: two "TarragonHealth"
 * headers, and two identical Home/Vitals/Meds/Messages/More tab bars, one
 * directly above the other. Embedded requests render the page content on its
 * own and let the native shell do the navigating.
 *
 * Checks the User-Agent first (works from the very first byte, before any
 * cookie could exist) and falls back to the cookie above — belt and braces,
 * since either signal alone has a real gap: the UA can lose the Android race
 * described on EMBEDDED_APP_COOKIE, and the cookie doesn't exist yet on a
 * WebView's true first-ever request (before mobile-bridge has run once).
 */
export async function isEmbeddedInApp(): Promise<boolean> {
  const userAgent = (await headers()).get("user-agent") ?? "";
  if (userAgent.includes(EMBEDDED_UA_TOKEN)) return true;
  return (await cookies()).get(EMBEDDED_APP_COOKIE)?.value === "1";
}
