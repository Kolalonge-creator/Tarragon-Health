import Link from "next/link";
import { loadFoundingOffer, type FoundingOffer } from "@/lib/marketing/founding-offer";
import { foundingLadderPriceLabels, membershipLadderPriceLabels, membershipLadderPublic } from "@/lib/marketing/membership";
import { cn } from "@/lib/utils";

/**
 * The founding member offer on /pricing and the homepage (founder decision 2026-11-04).
 *
 * Everything it says comes from the live founding code through `founding_offer_status()` (the percent, the code, the places) and from
 * versioned config (the two Membership prices). It renders NOTHING when the offer is closed, full, or the read fails: never a stale
 * or invented number of places. The code is shown, never applied for anyone: the visitor types it at checkout.
 *
 * Calm on purpose: no countdown, no animation, no "hurry". The places bar is decoration; the sentence beside it carries the figure.
 */
export async function FoundingMembersStrip({ className }: { className?: string }) {
  const offer = await loadFoundingOffer();
  if (!offer) return null;
  return <FoundingMembersPanel offer={offer} ladder={membershipLadderPublic()} className={className} />;
}

/** The panel itself, a pure function of the offer, so it can be rendered and tested without a database. */
export function FoundingMembersPanel({ offer, ladder, className }: { offer: FoundingOffer; ladder: boolean; className?: string }) {
  const taken = offer.placesTotal - offer.placesLeft;
  const takenPct = Math.min(100, Math.max(0, Math.round((taken / offer.placesTotal) * 100)));
  const founding = ladder ? foundingLadderPriceLabels(offer.percent) : null;
  const list = ladder ? membershipLadderPriceLabels() : null;
  return (
    <section
      aria-labelledby="founding-members-title"
      className={cn("px-4 py-10 sm:px-6 sm:py-14", className)}
      data-testid="founding-members"
    >
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-deep-forest text-white shadow-lg ring-1 ring-black/5">
        <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Founding members</p>
            <h2 id="founding-members-title" className="mt-3 font-heading text-2xl font-semibold leading-tight sm:text-3xl">
              {`Founding members: ${offer.percent}% off your first year`}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
              Be one of the first people to join Tarragon. Founding members get a lower price for their first year and a Founding member
              badge in the app.
            </p>
            {founding && list ? (
              <dl className="mt-6 grid max-w-md gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-white/70">Membership</dt>
                  <dd className="mt-1 font-heading text-xl font-semibold">{founding.evergreen}</dd>
                  <dd className="text-xs text-white/70">{`First year, usually ${list.evergreen}`}</dd>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-white/70">Membership Plus</dt>
                  <dd className="mt-1 font-heading text-xl font-semibold">{founding.evergreenPlus}</dd>
                  <dd className="text-xs text-white/70">{`First year, usually ${list.evergreenPlus}`}</dd>
                </div>
              </dl>
            ) : null}
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
              Sign up, choose Membership or Membership Plus, and enter this code at checkout:
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
        <p className="border-t border-white/10 px-6 py-4 text-xs leading-relaxed text-white/70 sm:px-10">
          {`For the first year of Membership or Membership Plus only. One use per person. Open while places last. If you buy a year for someone else, you can use the code for them, and they become the founding member. The code takes ${offer.percent}% off the price shown at checkout; it does not apply to the upgrade from Membership to Membership Plus.`}
        </p>
      </div>
    </section>
  );
}
