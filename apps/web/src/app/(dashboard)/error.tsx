"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NAV_ICON } from "@/lib/icons";
import { isConnectivityError } from "@/lib/network/is-connectivity-error";

/**
 * Error boundary for the whole signed-in dashboard surface. Before this file
 * existed, an unexpected render/data error anywhere under (dashboard) fell
 * through to Next's unbranded default screen. This renders inside the app
 * shell (error.tsx wraps the page, not the layout above it), so the sidebar
 * and navigation stay usable while this segment shows the fallback.
 *
 * Next 16: `retry` re-fetches and re-renders the failed segment (the right
 * recovery for a server-component error); the legacy `reset` prop only
 * re-renders without re-fetching, so it is not used here. Named `retry` since
 * v16.3.0 stable (this repo's installed 16.3.3) — confirmed directly against
 * node_modules/next/dist/client/components/error-boundary.js, which passes
 * `retry: this.retry` and no longer passes an `unstable_retry` key at all;
 * the earlier `unstable_retry` prop name here (from the v16.2.0 interim
 * release) was calling `undefined()` on every click, silently no-opping the
 * "Try again" button platform-wide.
 *
 * This boundary covers EVERY role's dashboard, so nothing here may be
 * patient-specific. It used to link to /patient, which a clinician, admin,
 * finance, pharmacist or coordinator account cannot use: proxy.ts bounces
 * them straight back out, so the one offered recovery path looped. Being a
 * Client Component it cannot read the caller's profile to resolve
 * getRoleHomePath() itself, and fetching the role just to label a link would
 * add a second thing to fail inside an error screen. "/" is the correct
 * role-neutral destination instead: on the app host proxy.ts already
 * resolves it to getRoleHomePath(profile.role) for whoever is signed in (and
 * to /login for whoever is not), so one static href lands every role on its
 * own dashboard with no client-side role lookup at all.
 *
 * A dropped connection reaches this same boundary as any other unhandled
 * error — every one of the ~113 `useActionState`-backed Server Action call
 * sites in this app funnels an uncaught rejection here, unless (like
 * `logVital`, per docs/OFFLINE_RESILIENCE_AUDIT.md §4) it already catches its
 * own errors and resolves to a `{ error }` state instead of throwing, in
 * which case it never reaches this boundary at all and gets nothing from
 * this change. `isConnectivityError` tells a real connectivity failure (a
 * `fetch()` that never reached the server, or a Server Action the server no
 * longer recognises because a new deployment rotated out from under the
 * client's own JS bundle) apart from a genuine bug, so this can show a
 * distinct, less alarming "connection lost, try again" message instead of
 * implying something broke on Tarragon's side for the ~112 other call sites.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const isConnectivity = isConnectivityError(error);

  useEffect(() => {
    // Server-component errors arrive redacted with a digest for matching
    // against server logs; log it so support can correlate a report.
    console.error(error);
  }, [error]);

  const heading = "mt-4 font-heading text-2xl font-semibold text-charcoal-ink";
  const body = "mt-3 max-w-md text-sm text-charcoal-ink/70";
  let icon: ReactNode;
  let title: string;
  let message: string;
  if (isConnectivity) {
    // Amber, matching OfflineBanner's use of the same NAV_ICON.offline for
    // the same underlying condition — this is status/warning semantics, not
    // a brand moment, so it deliberately does not use text-brand-green.
    icon = <NAV_ICON.offline className="h-12 w-12 text-amber-600 dark:text-amber-300" aria-hidden />;
    title = "Connection lost";
    message =
      "We couldn’t reach the server. Nothing has been changed or lost: check your connection, then try again.";
  } else {
    icon = <p className="font-heading text-5xl font-bold text-brand-green">Oops</p>;
    title = "Something didn’t load properly";
    message =
      "This part of the page hit a snag on our side. Nothing has been changed or lost, and trying again usually sorts it out.";
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      {icon}
      <h1 className={heading}>{title}</h1>
      <p className={body}>{message}</p>
      {error.digest && (
        <p className="mt-2 text-xs text-charcoal-ink/40">Reference: {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={() => retry()}>
          Try again
        </Button>
        <Button asChild variant="outline" size="lg">
          {/* Deliberately "/" and not a role home — see the note above. */}
          <Link href="/">Back to your dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
