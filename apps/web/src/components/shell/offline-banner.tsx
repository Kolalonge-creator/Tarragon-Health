"use client";

import { useOnlineStatus } from "@/lib/network/use-online-status";
import { NAV_ICON } from "@/lib/icons";

/**
 * Persistent, non-dismissible notice for when the browser reports no
 * network connection — mounted once in (dashboard)/layout.tsx so it's
 * visible everywhere a patient or clinician can be mid-form. Non-dismissible
 * on purpose (unlike MfaNudgeBanner): the underlying condition can flip back
 * within seconds, and this is informational state, not a nag to postpone.
 *
 * Deliberately does not promise automatic retry or background sync — this
 * app has no offline write queue (see docs/OFFLINE_RESILIENCE_AUDIT.md for
 * why that's a separate, larger decision, not built here). The copy only
 * tells the patient what to do: wait for the connection, then try again.
 * This is an ambient signal explaining why an action might be about to
 * fail, not a guarantee that every form on the platform already handles a
 * dropped connection gracefully — logVital (patient/actions.ts) is fixed
 * per the same audit; other mutation call sites weren't individually
 * re-audited, see the audit doc's own scope note.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-4"
    >
      <NAV_ICON.offline
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300"
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium text-charcoal-ink dark:text-night-ink">You&apos;re offline</p>
        <p className="text-charcoal-ink/70 dark:text-night-ink/70">
          Nothing you enter right now will save. Wait for your connection to come back, then try
          again.
        </p>
      </div>
    </div>
  );
}
