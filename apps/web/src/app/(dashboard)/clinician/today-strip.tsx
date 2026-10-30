import Link from "next/link";
import type { Figure } from "@tarragon/shared";

type Tile = {
  label: string;
  figure: Figure;
  href: string;
  /** Plain note under the number when the figure is known. */
  note: string;
};

/**
 * Three tiles for today: appointments, notes to complete, reviews due. A tile
 * whose count could not be loaded says so; it never shows 0. Each tile is one
 * link of at least 44px, so it works with a thumb.
 */
export function TodayStrip({ tiles }: { tiles: readonly Tile[] }) {
  return (
    <section aria-label="Today" className="grid gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          className="flex min-h-[88px] flex-col justify-between rounded-2xl bg-white p-4 hover:bg-charcoal-ink/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:bg-night-card"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
            {tile.label}
          </span>
          {tile.figure.state === "known" ? (
            <span>
              <span className="font-heading text-3xl font-semibold text-charcoal-ink dark:text-night-ink">
                {tile.figure.value}
              </span>
              <span className="ml-2 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                {tile.note}
              </span>
            </span>
          ) : (
            <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Could not be loaded. Open the list to check.
            </span>
          )}
        </Link>
      ))}
    </section>
  );
}
