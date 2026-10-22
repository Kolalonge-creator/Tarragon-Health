import type { ReactNode } from "react";

/**
 * Empty state (UI-B change 14): one sentence and one button, the web peer of the mobile kit's EmptyState. An empty list is a fact
 * ("you have none"); a failed read is never shown through this (use LoadFailedState), so a broken page cannot pass for an empty one.
 */
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div role="status" className="space-y-3 rounded-lg border border-dashed p-4">
      <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{message}</p>
      {action}
    </div>
  );
}

/** The different "could not load" state: says so plainly, is not the same as empty, and offers Try again. */
export function LoadFailedState({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border p-4">
      <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{message}</p>
      <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium">
        {retryLabel}
      </button>
    </div>
  );
}
