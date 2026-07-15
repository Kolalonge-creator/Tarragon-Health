import { cn } from "@/lib/utils";

/** Guard Leaf mark: shield (protection) + sprout crown (prevention/growth) + checkmark vein (docs/BRAND_GUIDE.md §4). */

type Tone = "brand" | "on-navy";

export function GuardLeafMark({ className, tone = "brand" }: { className?: string; tone?: Tone }) {
  const shieldClass = tone === "on-navy" ? "fill-warm-ivory" : "fill-brand-green";
  const checkClass = tone === "on-navy" ? "stroke-clinical-navy" : "stroke-warm-ivory";

  return (
    <svg
      viewBox="0 0 100 112"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M50 6C55 15 66 15 71 13C71 13 74 19 68 25C63 30 55 30 50 26C45 30 37 30 32 25C26 19 29 13 29 13C34 15 45 15 50 6Z"
        className="fill-sprout-gold"
      />
      <path
        d="M50 22C50 22 20 44 20 66C20 88 36 100 50 106C64 100 80 88 80 66C80 44 50 22 50 22Z"
        className={shieldClass}
      />
      <path
        d="M36 65L46 75L67 50"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={checkClass}
      />
    </svg>
  );
}

/** Wordmark split-colour per docs/BRAND_GUIDE.md §4: "Tarragon" in ink, "Health" in brand green (gold on navy). */
export function Wordmark({ className, tone = "brand" }: { className?: string; tone?: Tone }) {
  if (tone === "on-navy") {
    return (
      <span className={cn("font-heading font-semibold text-white", className)}>
        Tarragon<span className="text-sprout-gold">Health</span>
      </span>
    );
  }

  return (
    <span className={cn("font-heading font-semibold text-charcoal-ink", className)}>
      Tarragon<span className="text-brand-green">Health</span>
    </span>
  );
}

export function BrandLockup({
  className,
  markClassName,
  wordmarkClassName,
  tone = "brand",
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  tone?: Tone;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <GuardLeafMark tone={tone} className={cn("h-9 w-9 shrink-0", markClassName)} />
      <Wordmark tone={tone} className={cn("text-lg", wordmarkClassName)} />
    </div>
  );
}
