"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Supabase's hosted recovery link (the live email template still uses the
 * default implicit-grant format, not the token_hash-based /auth/confirm
 * route) delivers the session via a URL fragment (#access_token=...), which
 * the server-only session check in page.tsx can never see: by the time
 * client JS runs, the server component has already rendered with no user.
 *
 * The obvious fix — letting the Supabase browser client auto-detect that
 * fragment on init — doesn't work here: @supabase/ssr's createBrowserClient
 * hardcodes flowType: "pkce", and GoTrueClient's implicit-grant detection
 * throws (silently, with the hash left untouched) the moment it sees an
 * access_token fragment under a pkce-flow client. So this parses the
 * fragment by hand and hands the tokens to setSession() directly, which has
 * no such flow-type gate — it just needs an access_token/refresh_token pair.
 */
export function ResetPasswordGate({ hasServerSession }: { hasServerSession: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<"ready" | "checking" | "none">(
    hasServerSession ? "ready" : "checking"
  );

  useEffect(() => {
    if (hasServerSession) return;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const supabase = createClient();

    const settle = (session: unknown) => {
      if (session) {
        window.history.replaceState(null, "", window.location.pathname);
        router.refresh();
        setStatus("ready");
      } else {
        setStatus("none");
      }
    };

    if (accessToken && refreshToken && params.get("type") === "recovery") {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ data }) => settle(data.session));
    } else {
      // No recovery fragment — fall back to whatever session (if any) is
      // already cookie-backed, covering the phone-OTP path racing this effect.
      supabase.auth.getSession().then(({ data }) => settle(data.session));
    }
  }, [hasServerSession, router]);

  useEffect(() => {
    if (status === "none") {
      // Must be the value /forgot-password actually renders a message for.
      // This used to send `expired_link`, which that page has never handled,
      // so an expired recovery link landed on a reset form with no
      // explanation of why it had been sent back. /auth/confirm has always
      // used `invalid_or_expired_link`; this is now the one spelling.
      router.replace("/forgot-password?error=invalid_or_expired_link");
    }
  }, [status, router]);

  if (status === "none") return null;

  if (status === "checking") {
    return (
      <p role="status" className="text-center text-sm text-charcoal-ink/50">
        Checking your reset link…
      </p>
    );
  }

  return <ResetPasswordForm />;
}
