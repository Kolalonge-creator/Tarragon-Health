"use client";

import { useState } from "react";
import { usePatientTimeline } from "@/lib/queries/patient-timeline";
import { PatientTimeline } from "@/components/patient-timeline";
import { TIMELINE_FILTERS, eventTypesFor, type TimelineFilterId } from "@/lib/timeline/timeline-filters";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

/**
 * Owns the "Load more" pagination state and the type filter for the full-history timeline page (spec §76.4; patient
 * dashboard 2.0 gap P18, spec 5.2).
 *
 * Pagination grows the `limit` passed to PatientTimeline on each click rather than accumulating offset pages: for one
 * patient's timeline a growing single query is simpler to get right. This component's own `usePatientTimeline` call uses
 * the exact queryKey PatientTimeline's internal call produces (patientId, limit, offset 0, types), so React Query dedupes
 * them into one request; this one only reads `data.length` / `isFetching` for the "Load more" button.
 *
 * The filter is applied in the query, so choosing one starts again from the first page of that type.
 */
export function TimelineClient({ patientId, allowNotes = false }: { patientId: string; allowNotes?: boolean }) {
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [filter, setFilter] = useState<TimelineFilterId | null>(null);
  const limit = pagesLoaded * PAGE_SIZE;
  const types = eventTypesFor(filter);

  const { data, isFetching } = usePatientTimeline(patientId, limit, 0, types);

  // .range() never returns more rows than requested, so reaching exactly `limit` rows is the "there may be more" signal.
  const hasMore = data !== undefined && data.length === limit;

  const choose = (next: TimelineFilterId | null) => {
    setFilter(next);
    setPagesLoaded(1);
  };
  const chosenLabel = TIMELINE_FILTERS.find((f) => f.id === filter)?.label;

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {[{ id: null, label: "Everything" } as const, ...TIMELINE_FILTERS].map((option) => {
          const active = option.id === filter;
          return (
            <button
              key={option.id ?? "all"}
              type="button"
              aria-pressed={active}
              onClick={() => choose(option.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
                active
                  ? "border-brand-green bg-brand-green text-white dark:border-brand-green-bright dark:bg-brand-green-bright dark:text-night-ground"
                  : "border-charcoal-ink/15 bg-white text-charcoal-ink hover:border-brand-green/50 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <PatientTimeline
        patientId={patientId}
        limit={limit}
        types={types}
        groupByMonth
        linkBasePath="/patient"
        onLoadMore={() => setPagesLoaded((n) => n + 1)}
        hasMore={hasMore}
        isLoadingMore={isFetching}
        allowNotes={allowNotes}
        emptyText={chosenLabel ? `Nothing under "${chosenLabel}" yet.` : undefined}
      />
    </div>
  );
}
