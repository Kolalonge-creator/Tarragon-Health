import { Suspense } from "react";
import { HeroScoreZone } from "@/app/(dashboard)/patient/hero-score-zone";
import { NextBestAction } from "@/app/(dashboard)/patient/next-best-action";

/**
 * The Overview's hero band — one full-width moment answering the two
 * questions a patient opens the app with: "how am I doing" (the Health
 * Score, left/top) and "what's the one thing to do next" (the same real,
 * priority-ordered NextBestAction, right/bottom). Server band composing a
 * client score zone; NextBestAction keeps its own Suspense so a slow
 * task-queue query never blocks the score from painting.
 */
export function OverviewHero({ patientId, eyebrow }: { patientId: string; eyebrow: string }) {
  return (
    <section
      aria-label="How you're doing and your next best step"
      className="overflow-hidden rounded-2xl border border-charcoal-ink/10 bg-white shadow-sm"
    >
      {/* Stacks score-first on phones; two zones side by side from lg. */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <HeroScoreZone patientId={patientId} eyebrow={eyebrow} />
        <Suspense
          fallback={
            <div
              aria-hidden
              className="min-h-40 animate-pulse bg-gradient-to-br from-deep-forest to-brand-green"
            />
          }
        >
          <NextBestAction patientId={patientId} />
        </Suspense>
      </div>
    </section>
  );
}
