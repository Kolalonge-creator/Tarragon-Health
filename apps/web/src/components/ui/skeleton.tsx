import { cn } from "@/lib/utils";

/**
 * Generic pulse-block loading placeholder. Extracted from the pattern
 * `(dashboard)/patient/(sections)/loading.tsx` used before this existed —
 * that route now imports this instead of defining its own copy.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-2xl bg-charcoal-ink/[0.07] dark:bg-night-ink/10", className)}
    />
  );
}
