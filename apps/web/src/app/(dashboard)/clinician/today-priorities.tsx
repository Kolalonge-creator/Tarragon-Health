"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { useWorklistCounts } from "@/lib/queries/worklist-counts";
import {
  LAUNCH_WORKLIST_BUCKET_LABEL,
  WORKLIST_HREF,
  WORKLIST_LABEL,
  worklistKeysInBucket,
  type LaunchWorklistBucket,
} from "@/lib/queries/launch-worklist";

const BUCKET_DESCRIPTION: Record<LaunchWorklistBucket, string> = {
  urgent: "Time-critical: escalations, safety, safeguarding, abnormal results.",
  paidWorkDue: "A patient or sponsor has paid for a specific piece of your time.",
  followUp: "Everything else that's real work, but not urgent or unpaid-for.",
};

const BUCKET_ORDER: LaunchWorklistBucket[] = ["urgent", "paidWorkDue", "followUp"];

/**
 * A founder-commissioned launch-scope audit's clinician-side ask: reduce the
 * default landing view to 3 priority buckets instead of the ~50-destination
 * sidebar, WITHOUT removing anything — every link here goes to the exact
 * same worklist page navigation.ts already links to. Purely additive: sits
 * above the existing "Urgent escalations"/"Notes to complete" cards on the
 * shared clinician dashboard (same page every doctor_tier lands on, per
 * CLAUDE.md's "never re-split the account role" rule), so nothing about who
 * sees what changes, only what's summarised first.
 *
 * Reuses useWorklistCounts (the same hook and the same counter definitions
 * every sidebar badge already calls) rather than a second query layer -- one
 * counter, one definition of "open," per worklist-counts.ts's own stated
 * invariant. This card's own key set (every classified worklist, including
 * referralsAwaitingClosure, which has no sidebar badge of its own) differs
 * from AppShell's nav-badge key set, so react-query's key-scoped cache
 * cannot actually share the two fetches -- this fires its own query, not a
 * cache hit off the sidebar's. Accepted for now: the alternative (dropping a
 * real worklist from this summary just to align cache keys) is the wrong
 * trade.
 */
export function TodayPriorities() {
  const buckets = useMemo(
    () => BUCKET_ORDER.map((bucket) => ({ bucket, keys: worklistKeysInBucket(bucket) })),
    []
  );
  const allKeys = useMemo(() => buckets.flatMap((b) => b.keys), [buckets]);
  const { data, isLoading, isError } = useWorklistCounts(allKeys);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {buckets.map(({ bucket, keys }) => {
        const total = data ? keys.reduce((sum, key) => sum + (data[key] ?? 0), 0) : null;
        const nonZero = data
          ? keys
              .map((key) => ({ key, count: data[key] ?? 0 }))
              .filter((row) => row.count > 0)
              .sort((a, b) => b.count - a.count)
          : [];

        return (
          <Card key={bucket}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">{LAUNCH_WORKLIST_BUCKET_LABEL[bucket]}</CardTitle>
                {total !== null && !isError && (
                  <span className="font-heading text-xl font-semibold text-charcoal-ink">{total}</span>
                )}
              </div>
              <CardDescription>{BUCKET_DESCRIPTION[bucket]}</CardDescription>
            </CardHeader>
            <CardContent>
              {isError ? (
                <LoadFailure>
                  Could not be loaded. Do not read this as &ldquo;nothing waiting&rdquo; — open the
                  worklist pages directly.
                </LoadFailure>
              ) : isLoading ? (
                <p className="text-sm text-charcoal-ink/60">Loading…</p>
              ) : nonZero.length === 0 ? (
                <p className="text-sm text-charcoal-ink/60">Nothing waiting here right now.</p>
              ) : (
                <ul className="space-y-1.5">
                  {nonZero.map(({ key, count }) => (
                    <li key={key}>
                      <Link
                        href={WORKLIST_HREF[key]}
                        className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1 text-sm hover:bg-charcoal-ink/[0.03]"
                      >
                        <span className="truncate text-charcoal-ink/80">{WORKLIST_LABEL[key]}</span>
                        <span className="shrink-0 font-medium text-charcoal-ink">{count}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
