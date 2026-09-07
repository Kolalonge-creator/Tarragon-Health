"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sanitizeRedirect } from "@/lib/auth/redirect";
import { EMBEDDED_APP_COOKIE } from "@/lib/embedded-webview";

/**
 * Closes the native/WebView SSO gap documented in
 * apps/mobile/src/screens/webview-screen.tsx: the WebView has its own cookie
 * jar, separate from the native app's Supabase session, so the mobile app
 * hands the native session's tokens over via URL fragment (never sent to a
 * server, unlike a query string) and this calls setSession() to establish a
 * cookie-backed web session before continuing to the intended page — same
 * setSession() pattern as ResetPasswordGate, for the same reason
 * (createBrowserClient hardcodes flowType: "pkce", so fragment
 * auto-detection can't be used).
 *
 * Also stamps the EMBEDDED_APP_COOKIE marker isEmbeddedInApp() falls back to
 * (see that file for why the User-Agent check alone isn't reliable on
 * Android) — set here, before the real navigation to `next`, so it already
 * exists by the time that request goes out.
 */
export function MobileBridgeGate() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    async function bridge() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const next = sanitizeRedirect(params.get("next")) ?? "/patient";

      if (!accessToken || !refreshToken) {
        return false;
      }

      const { data, error } = await createClient().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error || !data.session) {
        return false;
      }
      // 1 year: a static "this is the app's WebView" marker, not a session —
      // harmless to keep long-lived, and re-stamped on every bridge trip
      // anyway (see webview-screen.tsx, which always re-bridges).
      document.cookie = `${EMBEDDED_APP_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`;
      window.location.replace(next);
      return true;
    }

    bridge().then(
      (ok) => {
        if (!ok) setFailed(true);
      },
      () => setFailed(true)
    );
  }, []);

  useEffect(() => {
    if (failed) {
      router.replace("/login");
    }
  }, [failed, router]);

  if (failed) return null;

  return <p className="text-center text-sm text-charcoal-ink/50">Signing you in…</p>;
}
