"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the public marketing site. Same tone and shape as the
 * root not-found page — warm, branded, and pointing back somewhere useful —
 * instead of Next's unbranded default error screen.
 *
 * Next 16: `unstable_retry` re-fetches and re-renders the failed segment;
 * the legacy `reset` prop only re-renders without re-fetching.
 */
export default function MarketingError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-white px-4 py-16 text-center text-charcoal-ink">
      <p className="font-heading text-5xl font-bold text-brand-green">Oops</p>
      <h1 className="mt-4 font-heading text-2xl font-semibold sm:text-3xl">
        Something didn&rsquo;t load properly
      </h1>
      <p className="mt-3 max-w-md text-charcoal-ink/70">
        That&rsquo;s on us, not you. Trying again usually sorts it out, or head back to the home
        page and start from there.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={() => unstable_retry()}>
          Try again
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
