import Link from "next/link";
import type { FirstView } from "@/lib/provider-org/first-view";

/**
 * Draws the provider organisation "Needs you first" block. What it says is
 * decided in lib/provider-org/first-view.ts.
 *
 * When the figures did not load this draws nothing: the page already shows the
 * failure notice, and a second one would say the same thing twice.
 */
export function ProviderOrgFirst({ view }: { view: FirstView }) {
  if (view.kind === "unknown") return null;

  return (
    <section
      aria-labelledby="provider-org-first"
      className="rounded-xl border border-charcoal-ink/10 bg-white p-5 shadow-sm"
    >
      <h2 id="provider-org-first" className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
        Needs you first
      </h2>
      {view.kind === "clear" && (
        <p className="mt-2 text-sm text-charcoal-ink/70">No referrals are paid and waiting, and none are on the waitlist.</p>
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
        </>
      )}
    </section>
  );
}
