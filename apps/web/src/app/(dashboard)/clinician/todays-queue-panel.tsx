"use client";

import Link from "next/link";
import { useWorklistCounts, type WorklistCountKey } from "@/lib/queries/worklist-counts";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";

const QUEUE_ITEMS: { key: WorklistCountKey; href: string; label: string }[] = [
  { key: "asyncConsults", href: "/clinician/async-consults", label: "Async consults waiting" },
  { key: "outreach", href: "/clinician/outreach", label: "Outreach tasks" },
  { key: "carePlanReviewPrompts", href: "/clinician/care-plan-review", label: "Care plans to review" },
  { key: "medicationReviews", href: "/clinician/medication-reviews", label: "Medication reviews due" },
];

/**
 * Curated 4-item glance at the Overview, distinct from the full 14-worklist
 * WorklistCountStrip further down the page — same live counts (this reuses
 * useWorklistCounts, not a separate definition of "open"), just the handful
 * most worth a doctor's first look each morning.
 */
export function TodaysQueuePanel() {
  const { data: counts, isLoading, isError } = useWorklistCounts(QUEUE_ITEMS.map((i) => i.key));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s queue</CardTitle>
        <CardDescription>What&apos;s waiting on you right now.</CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          // Never fall through to the list on error: every badge would read
          // "0" and a doctor would take that as "nothing waiting on me".
          <LoadFailure>
            These counts could not be loaded, so do not read this panel as an empty queue. Reload
            the dashboard, and open the worklists directly in the meantime.
          </LoadFailure>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {QUEUE_ITEMS.map(({ key, href, label }) => {
              const count = counts?.[key];
              return (
                <li key={key}>
                  <Link
                    href={href}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm font-medium text-charcoal-ink hover:text-deep-forest"
                  >
                    <span>{label}</span>
                    <span className="rounded-full bg-soft-sage px-2.5 py-0.5 text-xs font-semibold text-deep-forest">
                      {isLoading ? "…" : (count ?? 0)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
