import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The honest "this query failed" block for a staff surface.
 *
 * A staff dashboard that swallows a query error renders the failure as good
 * news: an empty worklist, a zero counter, "you're caught up". On a clinical
 * queue that is the single worst thing the UI can say, because it is
 * indistinguishable from a genuinely clear board and nobody goes looking.
 * The AI governance console (admin/settings/ai-governance/page.tsx) made this
 * argument first — "a blank page reads as 'nothing to worry about', which is
 * the one wrong message it could send" — and this is that same card, factored
 * out so the next surface does not have to reinvent the wording or the tone.
 *
 * Deliberately in the clinical status palette (red), not a brand tone: this
 * is a status signal, and BRAND_GUIDE.md keeps those two systems apart. Voice
 * stays plain and non-alarmist per the same guide — it says what is not known
 * and what to do, without shouting.
 *
 * Use it INSTEAD OF the empty state, never above it, so there is no partly
 * rendered "0 items" left on screen to be misread.
 */
export function LoadFailure({
  children,
  className,
}: {
  /** What could not be loaded, and what the operator should do instead. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
        className
      )}
    >
      {children}
    </p>
  );
}
