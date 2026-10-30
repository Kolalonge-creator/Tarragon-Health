import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../utils";

/**
 * A titled section that is folded by default and opens in place. Native
 * <details>, so it works without JavaScript and is keyboard and screen-reader
 * accessible for free. Use it to keep a long page short: put the rarely needed
 * material (catalogues, directories, history) inside, and the main task above.
 */
export function Disclosure({
  title,
  hint,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  /** One quiet line under the title saying what is inside. */
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn("group rounded-2xl border border-charcoal-ink/10 bg-white p-1 dark:border-night-ink/15 dark:bg-night-card", className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2 hover:bg-charcoal-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:hover:bg-night-ink/10 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-sm font-semibold text-charcoal-ink dark:text-night-ink">{title}</span>
          {hint && <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">{hint}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-charcoal-ink/60 transition-transform group-open:rotate-180 dark:text-night-ink/60" aria-hidden />
      </summary>
      <div className="space-y-4 p-3 pt-4">{children}</div>
    </details>
  );
}
