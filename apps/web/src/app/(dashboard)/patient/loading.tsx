import { Skeleton as SkeletonBlock } from "@/components/ui/skeleton";

/**
 * Instant loading state for every patient route that is NOT inside the
 * (sections) route group — Appointments, Messages, Receipts, Wellness, the
 * Health Check, Timeline, Quick log, and the rest.
 *
 * All of those are async server components doing Supabase reads, and until
 * this existed only (sections) had a loading.tsx: tapping any other sidebar
 * item on a slow mobile connection left the previous screen frozen with no
 * sign anything had happened. One boundary here covers the whole group
 * rather than 35 near-identical files; (sections) keeps its own richer
 * skeleton, which wins for those routes because it sits deeper in the tree.
 *
 * Shaped after PageHeader (icon + title + description, sitting on a rule)
 * followed by a stack of cards, which is what nearly every one of these
 * pages renders.
 */

export default function PatientRouteLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading this page">
      {/* PageHeader: icon square beside a title and description line, above
          the header's bottom rule. */}
      <div className="space-y-3">
        <div className="flex items-start gap-3 border-b border-charcoal-ink/10 pb-4 dark:border-night-ink/15">
          <SkeletonBlock className="h-11 w-11 shrink-0 rounded-2xl" />
          <div className="w-full space-y-2">
            <SkeletonBlock className="h-7 w-56 max-w-full" />
            <SkeletonBlock className="h-4 w-80 max-w-full" />
          </div>
        </div>
      </div>
      {/* Card stack — the shape shared by nearly every page in this group. */}
      <SkeletonBlock className="h-40" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonBlock className="h-52" />
        <SkeletonBlock className="h-52" />
      </div>
      <SkeletonBlock className="h-36" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
