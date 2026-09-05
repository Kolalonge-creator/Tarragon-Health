"use client";

import Link from "next/link";
import { useWorklistCounts, type WorklistCountKey } from "@/lib/queries/worklist-counts";
import { APP_ICON, type AppIconName } from "@/lib/icons";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { refreshQueryState } from "@/lib/queries/list-query-state";
import { cn } from "@/lib/utils";

export type WorklistCountTile = {
  key: WorklistCountKey;
  href: string;
  label: string;
  /**
   * A NAME into APP_ICON, not a component reference — this renders inside a
   * Client Component but is defined by Server Component pages, and a Lucide
   * component (a forwardRef object) isn't a plain serialisable value across
   * that boundary. Same fix as navigation.ts's own icon-name convention.
   */
  icon: AppIconName;
};

/**
 * "What's actually waiting for me today" — a single glance at every
 * worklist's open count instead of visiting each of the 12+ separate pages
 * to find out. Zero-count tiles are deliberately de-emphasised (grey, not
 * hidden) rather than removed — a doctor should be able to confirm "I
 * checked and there's nothing there" at the same glance, not wonder whether
 * a missing tile means zero or means the page failed to load.
 */
export function WorklistCountStrip({ tiles }: { tiles: WorklistCountTile[] }) {
  const { data: counts, isLoading, isError } = useWorklistCounts(tiles.map((t) => t.key));
  const state = refreshQueryState({ isLoading, isError, hasData: counts !== undefined });

  if (state === "failed") {
    // Deliberately loud, and deliberately instead of the tiles rather than
    // above them: a grid of grey zeroes is indistinguishable from a genuinely
    // clear board, and that is the one thing this strip must never claim on a
    // failed read.
    return (
      <LoadFailure>
        These worklist counts could not be loaded, so nothing here can be read as zero. Each
        worklist page still opens from the sidebar; reload this dashboard to try again.
      </LoadFailure>
    );
  }

  return (
    <div className="space-y-2">
      {/* This strip polls every 60 seconds, so one timed-out refresh must not
          take a screen of counts that did load away from the doctor reading
          them. Counts that were right a minute ago, said to be a minute old,
          beat no counts at all; a first load that never succeeded still gets
          the loud branch above. */}
      {state === "stale" && (
        <StaleDataNotice>
          These counts could not be refreshed just now, so they may have moved on. They are the
          last ones we read successfully, not a live board. Reload to try again.
        </StaleDataNotice>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tiles.map(({ key, href, label, icon }) => {
          const count = counts?.[key];
          const hasWork = typeof count === "number" && count > 0;
          const Icon = APP_ICON[icon];
          return (
            <Link
              key={key}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-3 transition-colors",
                hasWork
                  ? "border-brand-green/30 bg-brand-green/5 hover:border-brand-green/50"
                  : "border-charcoal-ink/10 bg-white hover:border-charcoal-ink/20"
              )}
            >
              <Icon
                className={cn("h-4 w-4 shrink-0", hasWork ? "text-brand-green" : "text-charcoal-ink/40")}
                strokeWidth={2}
              />
              <span className="min-w-0">
                <span
                  className={cn(
                    "block font-heading text-lg font-semibold leading-none",
                    hasWork ? "text-deep-forest" : "text-charcoal-ink/50"
                  )}
                >
                  {state === "loading" ? "…" : (count ?? 0)}
                </span>
                <span className="block truncate text-xs text-charcoal-ink/60">{label}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
