"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * "Continue with Google" for sign-in and sign-up (founder decision 2026-11-04). Hands off to Google through Supabase Auth; the
 * person comes back through /auth/callback. A Google sign-up carries no date of birth or phone, so a new patient is held in
 * onboarding until both are given: the phone step there (onboarding/phone-step.tsx), then the existing date-of-birth step, where the
 * database refuses anyone under 18 (private.enforce_adult_registration). The invite-only rule still applies, in the database trigger
 * on auth.users, and a refusal comes back to /login?error=google with a plain explanation.
 */
export function GoogleSignInButton({ redirectTo, label = "Continue with Google" }: { redirectTo?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const callback = new URL("/auth/callback", window.location.origin);
    // Marks the round trip as Google's, so a failure is explained as one (an expired email link also comes back with ?error=).
    callback.searchParams.set("via", "google");
    if (redirectTo) callback.searchParams.set("redirect", redirectTo);
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString(), queryParams: { prompt: "select_account" } },
    });
    // On success the browser is already leaving for Google; only a failure to start comes back here.
    if (oauthError) {
      setError("Could not open Google sign-in. Try again, or sign in another way.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="h-11 w-full rounded-xl" disabled={busy} onClick={start}>
        <GoogleMark />
        <span className="ml-2">{busy ? "Opening Google…" : label}</span>
      </Button>
      {error && (
        <p role="alert" className="text-center text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Google's "G" mark, as Google's sign-in branding guidelines ask for on a "Continue with Google" button. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
