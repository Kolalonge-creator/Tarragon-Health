"use client";

import * as React from "react";
import Link from "next/link";
import { useOutstandingConsentTypes } from "@/lib/queries/consent";
import { APP_ICON } from "@/lib/icons";
import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "th_consent_nudge_dismissed";

/**
 * Soft, dismissible reminder that at least one consent type has gone stale
 * (a consent_versions bump superseded a version this patient already
 * accepted, or a type was never accepted at all) — read-only, never a gate.
 * Only ever mounted for an already-onboarded patient (the caller gates that
 * server-side, in (dashboard)/layout.tsx, on profiles.onboarding_completed_at
 * — the onboarding wizard's own ConsentStep is the gate for anyone still mid-
 * onboarding, so this banner must never double up with it). Dismissal is
 * sessionStorage-only, same as MfaNudgeBanner, and for the same reason: it
 * reappears on the next fresh login/browser session, since the underlying
 * gap (an outstanding consent) hasn't changed. Dismissing never blocks
 * anything else on the dashboard.
 */
export function ConsentNudgeBanner({ patientId }: { patientId: string }) {
  const [dismissed, setDismissed] = React.useState(true);
  const { outstanding, isLoading } = useOutstandingConsentTypes(patientId);

  React.useEffect(() => {
    // setDismissed is called from inside this callback, not synchronously in
    // the effect body — same pattern as MfaNudgeBanner/PushSubscribePrompt.
    void (() => {
      try {
        setDismissed(window.sessionStorage.getItem(DISMISSED_KEY) === "1");
      } catch {
        // sessionStorage unavailable — fall through and show the nudge anyway.
        setDismissed(false);
      }
    })();
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // fine to skip persisting the dismissal — worst case it re-shows once.
    }
  };

  if (isLoading || dismissed || outstanding.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-xl border border-brand-green/20 bg-brand-green/5 p-4"
    >
      <APP_ICON.privacy
        className="mt-0.5 h-5 w-5 shrink-0 text-brand-green dark:text-brand-green-bright"
        strokeWidth={2}
      />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium text-charcoal-ink dark:text-night-ink">
          Your consent needs a quick update
        </p>
        <p className="text-charcoal-ink/70 dark:text-night-ink/70">
          {outstanding.length === 1
            ? "One item in your consent has changed since you last agreed to it."
            : `${outstanding.length} items in your consent have changed since you last agreed to them.`}{" "}
          <Link
            href="/patient/privacy"
            className="font-medium text-deep-forest underline underline-offset-2 dark:text-brand-green-bright"
          >
            Review and accept
          </Link>
          .
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="relative h-7 w-7 shrink-0 p-0 text-charcoal-ink/40 after:absolute after:-inset-2 after:content-[''] hover:text-charcoal-ink dark:text-night-ink/50 dark:hover:text-night-ink"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <APP_ICON.close className="h-4 w-4" strokeWidth={2} aria-hidden />
      </Button>
    </div>
  );
}
