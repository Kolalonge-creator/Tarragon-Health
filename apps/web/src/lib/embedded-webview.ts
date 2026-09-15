import { cookies, headers } from "next/headers";
import { EMBEDDED_APP_COOKIE, EMBEDDED_UA_TOKEN } from "./embedded-webview-constants";

export { EMBEDDED_APP_COOKIE, EMBEDDED_UA_TOKEN };

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
