import type { BadgeProps } from "@/components/ui/badge";

/** Maps a Badge variant to the matching StatTile tint/icon override classes,
 * so severity-count tiles read consistently with the Badge chips already on
 * each worklist row. Deliberately separate from lib/worklist/level-badge.ts
 * (which stays untouched) — this is presentation glue, not the clinical
 * status taxonomy itself. */
export const SEVERITY_TILE_TINT: Record<
  NonNullable<BadgeProps["variant"]>,
  { tintClassName: string; iconClassName: string }
> = {
  red: { tintClassName: "bg-red-100 dark:bg-red-500/25", iconClassName: "text-red-700 dark:text-red-300" },
  amber: { tintClassName: "bg-amber-100 dark:bg-amber-500/25", iconClassName: "text-amber-700 dark:text-amber-300" },
  blue: { tintClassName: "bg-blue-100 dark:bg-blue-500/25", iconClassName: "text-blue-700 dark:text-blue-300" },
  grey: { tintClassName: "bg-charcoal-ink/10 dark:bg-night-ink/15", iconClassName: "text-charcoal-ink/70 dark:text-night-ink/70" },
  green: { tintClassName: "bg-green-100 dark:bg-green-500/25", iconClassName: "text-green-700 dark:text-green-300" },
};
