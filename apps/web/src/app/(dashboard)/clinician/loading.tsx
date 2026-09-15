import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading state for every /clinician route — the case dashboard, every
 * worklist/queue page, patient/case/referral detail views, and every
 * operational console. Next.js shows this the moment navigation starts (it
 * wraps page.tsx and any nested segment below it that doesn't define a more
 * specific loading.tsx), so the shell paints immediately instead of waiting on
 * whichever page's server query is slowest — mirrors the same pattern already
 * used for admin/loading.tsx. Shaped as a generic header + stat-tile row +
 * card-stack, since that's the layout nearly every clinician page shares
 * regardless of which queue or record it's showing.
 */
export default function ClinicianLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading clinician dashboard">
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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
