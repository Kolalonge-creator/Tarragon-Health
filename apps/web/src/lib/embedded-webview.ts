import { headers } from "next/headers";

/**
 * The token the Expo app appends to its WebView User-Agent
 * (apps/mobile/src/screens/webview-screen.tsx). Keep the two in sync.
 */
export const EMBEDDED_UA_TOKEN = "TarragonHealthApp";

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
 * Read from the User-Agent rather than a query parameter so it survives every
 * link the patient follows inside the WebView without having to thread a
 * parameter through each one.
 */
export async function isEmbeddedInApp(): Promise<boolean> {
  const userAgent = (await headers()).get("user-agent") ?? "";
  return userAgent.includes(EMBEDDED_UA_TOKEN);
}
