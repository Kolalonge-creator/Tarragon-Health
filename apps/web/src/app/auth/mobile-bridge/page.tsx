import { connection } from "next/server";
import { MobileBridgeGate } from "./mobile-bridge-gate";

/**
 * Entry point the native mobile app's WebView sections load first (see
 * apps/mobile/src/screens/webview-screen.tsx) instead of the target page
 * directly. No server-side session check here on purpose — the whole point
 * is that the WebView has no session yet; MobileBridgeGate establishes one
 * client-side from the fragment, then continues on.
 */
// Rendered per request (CSP step 2, 2026-11-06): the app host's enforced policy only lets scripts carrying that request's nonce run,
// and a page prebuilt at deploy time has no request to take a nonce from, so its scripts would be blocked.
export default async function MobileBridgePage() {
  await connection();
  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <MobileBridgeGate />
    </div>
  );
}
