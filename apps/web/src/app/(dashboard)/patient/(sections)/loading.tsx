import { Skeleton as SkeletonBlock } from "@/components/ui/skeleton";

/**
 * Instant loading state for every patient section route (Overview, Vitals,
 * Medications, ...). Shown by Next.js the moment navigation starts, while the
 * section's server components fetch — so the shell paints immediately instead
 * of the whole page waiting on the slowest query. Shaped after the Overview's
 * own layout (hero band, quick actions, stat tiles, paired cards) so the
 * swap-in doesn't jump; the other sections are card stacks too, so it reads
 * right for them as well.
 */

export default function PatientSectionLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading your dashboard">
      {/* hero band — score zone stacked above the action zone on phones,
          side by side on lg, mirroring OverviewHero's height */}
      <SkeletonBlock className="h-72 lg:h-48" />
      {/* quick actions row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
      </div>
      {/* stat tile row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SkeletonBlock className="h-28" />
        <SkeletonBlock className="h-28" />
        <SkeletonBlock className="h-28" />
        <SkeletonBlock className="h-28" />
      </div>
      {/* paired card grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonBlock className="h-44" />
        <SkeletonBlock className="h-44" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonBlock className="h-56" />
        <SkeletonBlock className="h-56" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
