"use client";

import { useLabPartnerDashboardStats } from "@/lib/queries/lab-specimens";
import { labPartnerFirstView } from "@/lib/lab-partner/first-view";
import { LoadFailure } from "@/components/ui/load-failure";

/**
 * The first thing on the lab home. Which items show, in what order, and when
 * the view must refuse to say "nothing waiting" is decided in
 * lib/lab-partner/first-view.ts, where it is tested.
 */
export function LabPartnerFirst({ awaiting }: { awaiting: number | null }) {
  const { data: stats, isError } = useLabPartnerDashboardStats();
  const view = labPartnerFirstView({
    awaiting,
    delayed: stats?.samples_delayed,
    delayedFailed: isError && !stats,
  });

  if (view.kind === "unknown") {
    return (
      <LoadFailure>
        Some counts did not load, so we cannot say whether anything is waiting on you. Refresh the page to try again.
      </LoadFailure>
    );
  }

  return (
    <section
      aria-labelledby="lab-first"
      className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm"
    >
      <h2 id="lab-first" className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Needs you first
      </h2>
      {view.kind === "loading" && <p className="mt-2 text-sm text-charcoal-ink/60">Checking your orders and samples…</p>}
      {view.kind === "clear" && (
        <p className="mt-2 text-sm text-charcoal-ink/70">No delayed samples and no orders waiting for a result.</p>
      )}
      {view.kind === "items" && (
        <>
          <a
            href={view.top.href}
            className="mt-2 inline-flex font-heading text-xl font-semibold text-charcoal-ink hover:underline"
          >
            {view.top.text}
          </a>
          {view.rest.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {view.rest.map((item) => (
                <li key={item.key}>
                  <a href={item.href} className="font-medium text-brand-green hover:underline">
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {view.incomplete && (
            <p className="mt-3 text-sm text-charcoal-ink/60">
              This list is incomplete: some counts did not load. Refresh the page to try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
