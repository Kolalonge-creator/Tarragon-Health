import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StatTileValueProps } from "./stat-tile-value";

const ICON_TINT = {
  sage: "bg-soft-sage dark:bg-brand-green/20",
  gold: "bg-sprout-gold/15 dark:bg-sprout-gold/20",
  ivory: "bg-warm-ivory dark:bg-night-ink/10",
} as const;

const DELTA_COLOR = {
  up: "text-brand-green dark:text-brand-green-bright",
  down: "text-sprout-gold",
  flat: "text-charcoal-ink/50 dark:text-night-ink/55",
} as const;

// Clinical status colours (the Badge palette), never brand tones — a severity
// word like "Crisis range" must not render in decorative sprout-gold.
const STATUS_COLOR = {
  green: "text-green-700 dark:text-green-300",
  amber: "text-amber-700 dark:text-amber-300",
  red: "text-red-700 dark:text-red-300",
} as const;

interface StatTileBaseProps {
  icon: LucideIcon;
  /** Brand-tier tint for the icon circle. Ignored if `tintClassName` is set. */
  iconTint?: keyof typeof ICON_TINT;
  /** Escape hatch: overrides the icon circle's background entirely. Use this
   * for clinical-severity tiles so they key off the existing Badge palette
   * (e.g. "bg-red-100") instead of the brand sage/gold/ivory tints. */
  tintClassName?: string;
  /** Pairs with `tintClassName` — overrides the icon's own colour (e.g.
   * "text-red-700" to match a Badge's text colour on a severity tile). */
  iconClassName?: string;
  label: string;
  /** Brand-toned directional note ("↑ 2 this week" style). For a clinical
   * severity word, use `status` instead — the two are separate colour systems
   * and must never be blended in one line. */
  delta?: { text: string; direction: "up" | "down" | "flat" };
  /** Clinical-status counterpart to `delta`: renders in the dashboard status
   * palette (green/amber/red), e.g. a BP band label like "Crisis range". */
  status?: { text: string; tone: keyof typeof STATUS_COLOR };
  className?: string;
}

/** A tile shows either a real display-scale value or a friendly muted hint —
 * never a bare display-scale "—". The union keeps a caller from passing
 * both (or a unit with no value to attach it to); `statTileValue` is the
 * helper that builds either side of it from a possibly-absent reading, so a
 * call site can't spell the empty case as a dash. */
export type StatTileProps = StatTileBaseProps & StatTileValueProps;

export function StatTile({
  icon: Icon,
  iconTint = "sage",
  tintClassName,
  iconClassName,
  label,
  value,
  unit,
  delta,
  status,
  empty,
  className,
}: StatTileProps) {
  return (
    // Icon stacks above the text on phones. Side by side, a wide value like
    // "120/80 mmHg" cannot fit beside the icon in a half-width grid cell at
    // 375px: the text block has no room to shrink, so the tile pushed the
    // whole document 68px wider than the viewport and every patient page
    // using these tiles scrolled sideways.
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:gap-4 sm:p-5 dark:border-night-ink/15 dark:bg-night-card dark:shadow-none",
        className
      )}
    >
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
          tintClassName ?? ICON_TINT[iconTint]
        )}
      >
        <Icon
          className={cn("h-5 w-5", iconClassName ?? "text-deep-forest dark:text-brand-green-bright")}
          strokeWidth={2}
        />
      </div>
      {/* min-w-0 lets the value wrap instead of forcing the flex row wider
          than its cell. */}
      <div className="min-w-0">
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{label}</p>
        {empty ? (
          <p className="text-base text-charcoal-ink/50 dark:text-night-ink/55">{empty.hint}</p>
        ) : (
          // Flat text-3xl: at sm:text-4xl a four-across tile can't hold
          // "195/120" and the value wraps mid-number. The hero band carries
          // the page's one display-scale figure; tiles stay a step below.
          <p className="font-heading text-3xl font-semibold break-words text-charcoal-ink dark:text-night-ink">
            {value}
            {/* whitespace-nowrap: the value may wrap (break-words above), but a
                unit like "mmHg" must never break mid-word into "mm / Hg". */}
            {unit && (
              <span className="ml-1 whitespace-nowrap text-base font-normal text-charcoal-ink/50 dark:text-night-ink/55">
                {unit}
              </span>
            )}
          </p>
        )}
        {status && (
          <p className={cn("text-xs font-medium", STATUS_COLOR[status.tone])}>{status.text}</p>
        )}
        {delta && <p className={cn("text-xs", DELTA_COLOR[delta.direction])}>{delta.text}</p>}
      </div>
    </div>
  );
}
