import Link from "next/link";
import type { FirstView } from "./_lib/first-view";

/**
 * Draws the pharmacist "Needs you first" block. What it says is decided in
 * _lib/first-view.ts.
 *
 * When the view cannot answer (loading, failed, or stale with nothing to
 * show) this draws nothing rather than a second notice: the orders, history
 * and pharmacy cards below already carry the loading, failed and out-of-date
 * messages for the same reads. It never draws "clear" in those states.
 */
export function PharmacistFirst({ view }: { view: FirstView }) {
  if (view.kind !== "items" && view.kind !== "clear") return null;

  return (
    <section
      aria-labelledby="pharmacist-first"
      className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm"
    >
      <h2 id="pharmacist-first" className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Needs you first
      </h2>
      {view.kind === "clear" && (
        <p className="mt-2 text-sm text-charcoal-ink/70">No orders waiting and your licence is in date.</p>
      )}
      {view.kind === "items" && (
        <>
          <Link
            href={view.top.href}
            className="mt-2 inline-flex font-heading text-xl font-semibold text-charcoal-ink hover:underline"
          >
            {view.top.text}
          </Link>
          {view.rest.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {view.rest.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="font-medium text-brand-green hover:underline">
                    {item.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {view.caveat === "incomplete" && (
            <p className="mt-3 text-sm text-charcoal-ink/60">
              This list is incomplete: some figures did not load. Reload the page to try again.
            </p>
          )}
          {view.caveat === "stale" && (
            <p className="mt-3 text-sm text-charcoal-ink/60">
              This list may be out of date: the last refresh failed. Reload the page to try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
