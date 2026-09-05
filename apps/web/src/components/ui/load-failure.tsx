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
 *
 * `role="alert"`, not `role="status"`: alert is an assertive live region, so
 * a screen reader interrupts to say the queue could not be read. Status is
 * polite and waits for a pause, which on a clinical worklist can mean the
 * operator never hears that the board in front of them is unread.
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
      role="alert"
      className={cn(
        "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300",
        className
      )}
    >
      {children}
    </p>
  );
}

/**
 * The third state: the data on screen is real, but the last refresh failed.
 *
 * A background poll that fails does not delete what already loaded, and
 * replacing a screen of known-good figures with LoadFailure tells the reader
 * less than keeping them and saying they may have moved on. Amber rather than
 * red, and a polite live region rather than an assertive one, because nothing
 * here is unread: it is simply older than it looks. Pair it with
 * refreshQueryState (lib/queries/list-query-state.ts), which is what tells
 * "the refresh failed" apart from "it never loaded".
 */
export function StaleDataNotice({
  children,
  className,
}: {
  /** Optional replacement for the default line, e.g. naming what went stale. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
        className
      )}
    >
      {children ??
        "These figures may be out of date: the last refresh failed. They are the last ones we read successfully, not a live count. Reload to try again."}
    </p>
  );
}
