import { cn } from "@/lib/utils";

/** Base shimmer block for loading states — compose into a layout that
 * mirrors the loaded content's shape (a title bar, a couple of text lines,
 * a stat number) so the page doesn't visibly jump once data arrives. Never
 * use bare "Loading…" text for a client-fetched card; use this instead. */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-soft-sage", className)}
      {...props}
    />
  );
}
