import Link from "next/link";
import { loadFoundingOffer, type FoundingOffer } from "@/lib/marketing/founding-offer";
import { foundingPriceLabel, membershipPriceLabel } from "@/lib/marketing/membership";
import { cn } from "@/lib/utils";

/**
 * The founding member offer on /pricing and the homepage (founder decision 2026-11-04).
 *
 * Everything it says comes from the live founding code through `founding_offer_status()` (the percent, the code, the places) and from
 * versioned config (the Membership price, commerce.membership_prices). It renders NOTHING when the offer is closed, full, or the read fails: never a stale
 * or invented number of places. The code is shown, never applied for anyone: the visitor types it at checkout.
 *
 * Calm on purpose: no countdown, no animation, no "hurry". The places bar is decoration; the sentence beside it carries the figure.
 */
export async function FoundingMembersStrip({ className }: { className?: string }) {
  const offer = await loadFoundingOffer();
  if (!offer) return null;
  return <FoundingMembersPanel offer={offer} className={className} />;
}

/** The panel itself, a pure function of the offer, so it can be rendered and tested without a database. */
export function FoundingMembersPanel({ offer, className }: { offer: FoundingOffer; className?: string }) {
  const taken = offer.placesTotal - offer.placesLeft;
  const takenPct = Math.min(100, Math.max(0, Math.round((taken / offer.placesTotal) * 100)));
  const founding = foundingPriceLabel(offer.percent);
  const list = membershipPriceLabel();
  return (
    <section
      aria-labelledby="founding-members-title"
      className={cn("px-4 py-10 sm:px-6 sm:py-14", className)}
      data-testid="founding-members"
    >
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-deep-forest text-white shadow-lg ring-1 ring-black/5">
        <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/90">Founding members</p>
            <h2 id="founding-members-title" className="mt-3 font-heading text-2xl font-semibold leading-tight sm:text-3xl">
              {`Founding members: ${offer.percent}% off your first year`}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
              Be one of the first people to join Tarragon. Founding members get a lower price for their first year and a Founding member
              badge in the app.
            </p>
            <dl className="mt-6 max-w-xs">
              <div className="rounded-2xl bg-white/10 px-4 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-white/90">Membership</dt>
                <dd className="mt-1 font-heading text-xl font-semibold">{"\u20A6" + founding}</dd>
                <dd className="text-xs text-white/90">{"First year, usually \u20A6" + list}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl bg-white p-6 text-charcoal-ink">
            <p className="font-heading text-lg font-semibold" data-testid="founding-places">
              {`${offer.placesLeft} of ${offer.placesTotal} places left`}
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-soft-sage" aria-hidden="true">
              <div className="h-full rounded-full bg-brand-green" style={{ width: `${takenPct}%` }} />
            </div>
            <h3 className="mt-5 text-sm font-semibold">How to use it</h3>
            <p className="mt-1 text-sm leading-relaxed text-charcoal-ink/75">
              Sign up, choose Membership, and enter this code at checkout:
            </p>
            <p className="mt-3">
              <span className="inline-block select-all rounded-lg border border-dashed border-brand-green/50 bg-soft-sage px-4 py-2 font-mono text-lg font-semibold tracking-widest text-deep-forest">
                {offer.code}
              </span>
            </p>
            <Link
              href="/signup"
              className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brand-green px-5 text-sm font-semibold text-white hover:bg-deep-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            >
              Join as a founding member
            </Link>
          </div>
        </div>
        <p className="border-t border-white/10 px-6 py-4 text-xs leading-relaxed text-white/90 sm:px-10">
          {`For the first year of Membership only. One use per person. Open while places last. If you buy a year for someone else, you can use the code for them, and they become the founding member. The code takes ${offer.percent}% off the price shown at checkout.`}
        </p>
      </div>
    </section>
  );
}
