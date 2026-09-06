import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading state for every /admin route — the homepage tile grid,
 * every /admin/settings/* config page, and every operational console.
 * Next.js shows this the moment navigation starts, so the shell paints
 * immediately instead of waiting on whichever page's server query is
 * slowest. Shaped as a generic header + card-stack, since that's the one
 * layout every admin page shares regardless of section.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading admin console">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-64" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
