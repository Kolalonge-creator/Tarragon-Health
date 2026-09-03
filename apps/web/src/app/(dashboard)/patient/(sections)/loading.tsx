/**
 * Instant loading state for every patient section route (Overview, Vitals,
 * Medications, ...). Shown by Next.js the moment navigation starts, while the
 * section's server components fetch — so the shell paints immediately instead
 * of the whole page waiting on the slowest query. Shaped after the Overview's
 * own layout (greeting line, hero banner, stat tiles, cards) so the swap-in
 * doesn't jump; the other sections are card stacks too, so it reads right for
 * them as well. No Skeleton primitive exists in this codebase yet — these are
 * plain pulse blocks in the app's own neutral tones.
 */
function SkeletonBlock({ className }: { className: string }) {
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-charcoal-ink/[0.07] ${className}`} />;
}

export default function PatientSectionLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading your dashboard">
      {/* greeting line */}
      <SkeletonBlock className="h-4 w-64 rounded-md" />
      {/* hero banner */}
      <SkeletonBlock className="h-32 sm:h-28" />
      {/* quick actions row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-20" />
      </div>
      {/* card stack */}
      <SkeletonBlock className="h-44" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonBlock className="h-56" />
        <SkeletonBlock className="h-56" />
      </div>
      <SkeletonBlock className="h-44" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
