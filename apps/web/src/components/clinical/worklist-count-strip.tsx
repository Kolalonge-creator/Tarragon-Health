"use client";

import Link from "next/link";
import { useWorklistCounts, type WorklistCountKey } from "@/lib/queries/worklist-counts";
import { APP_ICON, type AppIconName } from "@/lib/icons";
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

  if (isError) {
    return (
      <p className="text-sm text-charcoal-ink/60">
        Couldn&apos;t load today&apos;s worklist counts. The pages below still work, so try
        reloading this dashboard.
      </p>
    );
  }

  return (
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
                {isLoading ? "…" : (count ?? 0)}
              </span>
              <span className="block truncate text-xs text-charcoal-ink/60">{label}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
