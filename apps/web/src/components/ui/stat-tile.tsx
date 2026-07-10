import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_TINT = {
  sage: "bg-soft-sage",
  gold: "bg-sprout-gold/15",
  ivory: "bg-warm-ivory",
} as const;

const DELTA_COLOR = {
  up: "text-brand-green",
  down: "text-sprout-gold",
  flat: "text-charcoal-ink/50",
} as const;

export interface StatTileProps {
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
  value: string;
  unit?: string;
  delta?: { text: string; direction: "up" | "down" | "flat" };
  className?: string;
}

export function StatTile({
  icon: Icon,
  iconTint = "sage",
  tintClassName,
  iconClassName,
  label,
  value,
  unit,
  delta,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm",
        className
      )}
    >
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
          tintClassName ?? ICON_TINT[iconTint]
        )}
      >
        <Icon className={cn("h-5 w-5", iconClassName ?? "text-deep-forest")} strokeWidth={2} />
      </div>
      <div>
        <p className="text-sm text-charcoal-ink/60">{label}</p>
        <p className="font-heading text-3xl font-semibold text-charcoal-ink">
          {value}
          {unit && <span className="ml-1 text-base font-normal text-charcoal-ink/50">{unit}</span>}
        </p>
        {delta && <p className={cn("text-xs", DELTA_COLOR[delta.direction])}>{delta.text}</p>}
      </div>
    </div>
  );
}
