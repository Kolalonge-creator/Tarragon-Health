"use client";

import { useState, type ReactNode } from "react";

/**
 * "More about your health" (PD-05: everything not in the Home order lives here, loaded only when opened). The cards inside are
 * not mounted until the patient first opens the fold, so the client cards in it (charts, domains, timeline, heart age) fetch
 * nothing on a normal Home visit. Once opened it stays mounted, so closing and reopening does not refetch.
 *
 * Server cards passed in are still rendered on the server; each is wrapped in its own Suspense on the page so it streams and never
 * holds up the cards above.
 */
export function LazyFold({ title, children }: { title: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="group rounded-2xl border border-charcoal-ink/10 bg-white p-1 dark:border-night-ink/15 dark:bg-night-card"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl px-4 py-2 text-sm font-semibold text-charcoal-ink hover:bg-charcoal-ink/[0.03] dark:text-night-ink [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden className="text-charcoal-ink/60 transition-transform group-open:rotate-180 dark:text-night-ink/60">
          ⌄
        </span>
      </summary>
      {opened ? <div className="space-y-6 p-3 pt-4">{children}</div> : null}
    </details>
  );
}
