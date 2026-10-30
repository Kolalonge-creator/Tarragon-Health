"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import {
  isFailedAnalyticsQuery,
  pageReportsItsOwnFailures,
  worstAnalyticsLoadState,
} from "@/lib/analytics/load-failures";

/**
 * One honest line at the top of every analytics page when a figure on it did
 * not load. Without it, a dashboard that reads `data?.x ?? 0` shows the failure
 * as zeros, which look exactly like a quiet month. See
 * lib/analytics/load-failures.ts for the reasoning and for which pages already
 * report their own failures (this stays out of their way).
 *
 * Renders nothing in the normal case, so a healthy page is unchanged.
 */
export function AnalyticsLoadNotice() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();

  // Re-read whenever any query changes; the snapshot is a plain string, so
  // React only re-renders when the worst state actually changes.
  const state = useSyncExternalStore(
    (notify) => cache.subscribe(notify),
    () => worstAnalyticsLoadState(cache.getAll()),
    () => "none" as const
  );

  if (state === "none" || pageReportsItsOwnFailures(pathname)) return null;

  const retry = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="ml-3"
      onClick={() => void queryClient.refetchQueries({ predicate: isFailedAnalyticsQuery })}
    >
      Try again
    </Button>
  );

  if (state === "stale") {
    return (
      <StaleDataNotice>
        These figures may be out of date: the last refresh failed. They are the last ones we read
        successfully, not a live count.
        {retry}
      </StaleDataNotice>
    );
  }

  return (
    <LoadFailure>
      Some figures on this page could not be loaded. A zero or an empty chart here may mean a figure
      is missing, not that there is none.
      {retry}
    </LoadFailure>
  );
}
