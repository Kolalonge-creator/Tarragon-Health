import { cn } from "@/lib/utils";

/** Guard Leaf mark: shield (protection) + sprout crown (prevention/growth) + checkmark vein (docs/BRAND_GUIDE.md §4). */
export function GuardLeafMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 112"
      className={cn("h-10 w-10", className)}
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
        className="fill-brand-green"
      />
      <path
        d="M36 65L46 75L67 50"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-warm-ivory"
      />
    </svg>
  );
}
