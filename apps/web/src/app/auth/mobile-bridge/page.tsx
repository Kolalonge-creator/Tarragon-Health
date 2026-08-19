import { MobileBridgeGate } from "./mobile-bridge-gate";

/**
 * Entry point the native mobile app's WebView sections load first (see
 * apps/mobile/src/screens/webview-screen.tsx) instead of the target page
 * directly. No server-side session check here on purpose — the whole point
 * is that the WebView has no session yet; MobileBridgeGate establishes one
 * client-side from the fragment, then continues on.
 */
export default function MobileBridgePage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-charcoal-ink/[0.02] px-4 py-16">
      <MobileBridgeGate />
    </div>
  );
}
