"use client";

import { useState } from "react";
import { usePatientTimeline } from "@/lib/queries/patient-timeline";
import { PatientTimeline } from "@/components/patient-timeline";

const PAGE_SIZE = 30;

/**
 * Owns the "Load more" pagination state for the full-history timeline page
 * (spec §76.4). Rather than accumulating true offset-based pages, this grows
 * the `limit` passed to PatientTimeline on each click — PatientTimeline owns
 * its own `usePatientTimeline` call internally, and for a single patient's
 * realistic timeline size a growing single query is simpler to get right
 * than juggling an accumulated array across pages. The offset/range
 * primitive added to `usePatientTimeline` for this feature is still there
 * for any future caller that does want true offset paging.
 *
 * This component's own `usePatientTimeline` call below uses the exact same
 * queryKey PatientTimeline's internal call produces for this props
 * (patientId, limit, offset defaulting to 0) — React Query dedupes matching
 * keys into a single request, so this is not a second fetch, just a second
 * subscriber reading `data.length` / `isFetching` to drive the "Load more"
 * button's hasMore/isLoadingMore state. `placeholderData: keepPreviousData`
 * on the hook (see lib/queries/patient-timeline.ts) means growing the limit
 * never blanks the already-rendered list while the next page loads.
 */
export function TimelineClient({ patientId }: { patientId: string }) {
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const limit = pagesLoaded * PAGE_SIZE;

  const { data, isFetching } = usePatientTimeline(patientId, limit);

  // .range() never returns more rows than requested, so reaching exactly
  // `limit` rows is the "there may be more" signal; anything short of it
  // means the feed is exhausted.
  const hasMore = data !== undefined && data.length === limit;

  return (
    <PatientTimeline
      patientId={patientId}
      limit={limit}
      groupByMonth
      onLoadMore={() => setPagesLoaded((n) => n + 1)}
      hasMore={hasMore}
      isLoadingMore={isFetching}
    />
  );
}
