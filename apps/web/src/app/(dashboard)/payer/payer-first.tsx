import Link from "next/link";
import { LoadFailure } from "@/components/ui/load-failure";
import type { FirstView } from "@/lib/payer/first-view";

/** Draws the payer "Needs you first" block. What it says is decided in lib/payer/first-view.ts. */
export function PayerFirst({ view }: { view: FirstView }) {
  if (view.kind === "unknown") {
    return (
      <LoadFailure>
        Your work queues could not be loaded, so we cannot say whether anything is waiting on you. Refresh the page to
        try again.
      </LoadFailure>
    );
  }

  return (
    <section
      aria-labelledby="payer-first"
      className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm"
    >
      <h2 id="payer-first" className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Needs you first
      </h2>
      {view.kind === "clear" && (
        <p className="mt-2 text-sm text-charcoal-ink/70">
          No pre-authorisations to decide, no claims to adjudicate and no approved claims to pay.
        </p>
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
          {view.incomplete && (
            <p className="mt-3 text-sm text-charcoal-ink/60">
              This list is incomplete: some queues did not load. Refresh the page to try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
