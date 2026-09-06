"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the whole signed-in dashboard surface. Before this file
 * existed, an unexpected render/data error anywhere under (dashboard) fell
 * through to Next's unbranded default screen. This renders inside the app
 * shell (error.tsx wraps the page, not the layout above it), so the sidebar
 * and navigation stay usable while this segment shows the fallback.
 *
 * Next 16: `unstable_retry` re-fetches and re-renders the failed segment
 * (the right recovery for a server-component error); the legacy `reset` prop
 * only re-renders without re-fetching, so it is not used here.
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
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Server-component errors arrive redacted with a digest for matching
    // against server logs; log it so support can correlate a report.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-heading text-5xl font-bold text-brand-green">Oops</p>
      <h1 className="mt-4 font-heading text-2xl font-semibold text-charcoal-ink">
        Something didn&rsquo;t load properly
      </h1>
      <p className="mt-3 max-w-md text-sm text-charcoal-ink/70">
        This part of the page hit a snag on our side. Nothing has been changed or lost, and trying
        again usually sorts it out.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-charcoal-ink/40">Reference: {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={() => unstable_retry()}>
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
