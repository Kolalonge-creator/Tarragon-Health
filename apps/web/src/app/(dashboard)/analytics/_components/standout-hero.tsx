import Link from "next/link";
import { LoadFailure } from "@/components/ui/load-failure";
import type { StandoutView } from "@/lib/analytics/standout";

/**
 * Draws the "What stands out" block. What it says, and when it may say
 * "nothing", is decided in lib/analytics/standout.ts, where it is tested.
 */
export function StandoutHero({ view }: { view: StandoutView }) {
  if (view.kind === "unknown") {
    return (
      <LoadFailure>
        Some figures did not load, so we cannot say whether anything stands out. Reload the page to
        try again.
      </LoadFailure>
    );
  }

  return (
    <section
      aria-labelledby="analytics-standout"
      className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm"
    >
      <h2
        id="analytics-standout"
        className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60"
      >
        What stands out
      </h2>

      {view.kind === "loading" && (
        <p className="mt-2 text-sm text-charcoal-ink/60">Checking the latest figures.</p>
      )}

      {view.kind === "clear" && (
        <p className="mt-2 text-sm text-charcoal-ink/70">
          No open risk items, unverified licences, falling revenue or inactive facilities.
        </p>
      )}

      {view.kind === "items" && (
        <>
          <Link
            href={view.top.href}
            className="mt-2 inline-block font-heading text-xl font-semibold text-charcoal-ink hover:underline"
          >
            {view.top.text}
          </Link>
          {view.rest.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {view.rest.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="text-brand-green hover:underline">
                    {item.text}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {view.incomplete && (
            <p className="mt-3 text-xs text-charcoal-ink/60">
              This list is incomplete: some figures did not load. Reload the page to try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
