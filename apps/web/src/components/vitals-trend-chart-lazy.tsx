"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

function ChartSkeleton() {
  return (
    <div
      aria-hidden
      className="h-72 animate-pulse rounded-2xl bg-charcoal-ink/[0.07] dark:bg-night-ink/10"
    />
  );
}

// ssr: false is only legal from inside a Client Component, which is the
// whole point of this wrapper existing separately from the page: recharts
// is a meaningfully-sized charting library, and this card renders well
// below the fold on the highest-traffic page in the app, so it should
// neither be server-rendered nor hydrated until a patient actually scrolls
// to it.
const RechartsVitalsTrendChart = dynamic(
  () => import("./vitals-trend-chart").then((mod) => mod.VitalsTrendChart),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

/**
 * Genuinely defers the vitals trend chart — both its recharts bundle and
 * its own render/hydration — until it scrolls into view, rather than
 * merely code-splitting it into a chunk that still loads on first paint.
 * `next/dynamic` alone (even with a `loading` fallback) doesn't achieve
 * that from a Server Component parent: without a real gate like this one,
 * the dynamic import still resolves and renders on initial load, so the
 * skeleton fallback would rarely if ever be seen by a real user.
 *
 * Falls back to rendering immediately if IntersectionObserver isn't
 * available (a very old browser, or certain test/JSDOM environments)
 * rather than never rendering the chart at all.
 */
export function LazyVitalsTrendChart({ patientId }: { patientId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Resolved once, synchronously, rather than set from inside the effect
  // below — an environment with no IntersectionObserver at all is a fact
  // known up front, not something to react to.
  const [shouldRender, setShouldRender] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (shouldRender) return;
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          // Disconnecting happens via this effect's own cleanup below, once
          // the shouldRender dependency flips true and the effect re-runs —
          // not here too, which would just double-disconnect.
          setShouldRender(true);
        }
      },
      // Start loading slightly before the card is fully in view, so the
      // chart is ready by the time a scrolling patient actually reaches it.
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  return (
    <div ref={containerRef}>
      {shouldRender ? <RechartsVitalsTrendChart patientId={patientId} /> : <ChartSkeleton />}
    </div>
  );
}
