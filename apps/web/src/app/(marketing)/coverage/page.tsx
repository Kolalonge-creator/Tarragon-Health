import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { getServiceCoverage } from "@/lib/marketing/coverage-data";
import { getPartnerLocations } from "@/lib/marketing/partner-locations-data";
import { gatedServices, itemsFor } from "@/lib/coverage/what-works-where";
import { CoverageChecker } from "./coverage-checker";
import { PartnerMap } from "./partner-map";
import { pageMetadata } from "@/lib/marketing/site";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import type { PartnerLocation } from "@/lib/marketing/partner-locations-data";

const PARTNER_TYPE_DESCRIPTION: Record<PartnerLocation["type"], string> = {
  home_visit: "home visit collection",
  delivery: "delivery",
  lab: "contracted lab",
};

export const metadata: Metadata = pageMetadata({
  title: "Where we work: coverage by state",
  description:
    "Check which TarragonHealth services are live in any Nigerian state before you sign up, and see exactly what works from anywhere in the world.",
  path: MARKETING_ROUTES.coverage,
});

// The coverage answer changes only when ops contracts a partner or switches a
// state on, so a short cache is plenty and keeps the page fast for anon traffic.
export const revalidate = 300;

export default async function CoveragePage() {
  const coverage = await getServiceCoverage();
  const partnerLocations = await getPartnerLocations();
  const mapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  // row.isActive is the state's own master rollout switch, which can be on
  // with zero partners actually contracted there (true of every state right
  // now — see the 2026-08-03 self-arranged-fulfilment migrations). Filtering
  // on it alone would claim "partner-fulfilled services are live" in a state
  // where the checker below correctly says otherwise. Only a state with at
  // least one currently-gated service (home sample collection, medication
  // delivery — see gatedServices()) actually live belongs in this list.
  const gated = gatedServices();
  const liveStates = coverage.filter((row) =>
    gated.some((service) => row.services[service]),
  );
  const inNigeria = itemsFor("in_nigeria");

  return (
    <>
      <Section className="pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-heading text-4xl font-bold text-charcoal-ink sm:text-5xl">
            Where we work
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            TarragonHealth works anywhere in Nigeria. We tell you which tests
            are worth doing and when, write you a request to take to any lab you
            like, read the result with you, and follow up. None of that waits on
            us signing a partner in your state, so none of it is switched off
            where you live.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
            You pay the lab or the pharmacy directly, at their price. We take
            nothing on top.
          </p>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            What we do not yet do anywhere: collect a sample from your home, or
            deliver medication to your door. Those still need a contracted
            partner in your state, and we would rather say so than imply
            otherwise.
          </p>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Billing a lab on your behalf is the one exception: for some
            screening bundles, you can opt in to have us arrange it with our
            contracted lab partner and bill you directly, instead of paying the
            lab yourself. It is always optional, alongside the self-arranged
            path above.
          </p>
          {liveStates.length > 0 && (
            <p className="mt-4 text-sm text-charcoal-ink/60">
              Partner-fulfilled services are live in{" "}
              <span className="font-medium text-deep-forest">
                {liveStates.map((row) => row.displayName).join(", ")}
              </span>
              .
            </p>
          )}
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Coverage"
          title="Check a state"
          description="Screening guidance, test requests, uploading a result and doctor review work in every state. This checker shows the extra, partner-fulfilled services on top, and reads the same live list the app itself uses, so it can never promise something the product would then refuse."
        />
        <CoverageChecker coverage={coverage} />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Partner locations"
          title="Where our contracted partners are"
          description="Most of this page is self-arranged, so it needs no partner at all. A contracted lab, home visit or delivery partner is the exception — a real relationship we hold, not just a listing. This map shows exactly where those partners are, once we have one."
        />
        {mapsApiKey && partnerLocations.length > 0 && (
          <PartnerMap locations={partnerLocations} apiKey={mapsApiKey} />
        )}
        {(!mapsApiKey || partnerLocations.length === 0) && (
          <div className="mx-auto max-w-2xl rounded-2xl border border-charcoal-ink/15 bg-white p-6 text-center">
            {partnerLocations.length > 0 ? (
              <>
                <p className="text-sm font-medium text-charcoal-ink">
                  {partnerLocations.length} partner
                  {partnerLocations.length === 1 ? "" : "s"} contracted so far
                </p>
                <ul className="mt-3 space-y-2 text-left">
                  {partnerLocations.map((location) => (
                    <li
                      key={location.id}
                      className="text-sm text-charcoal-ink/70"
                    >
                      <span className="font-medium text-charcoal-ink">
                        {location.name}
                      </span>{" "}
                      — {PARTNER_TYPE_DESCRIPTION[location.type]},{" "}
                      {location.address}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-charcoal-ink/70">
                We haven&apos;t activated a contracted lab, home visit or
                delivery partner yet — check back, or{" "}
                <Link href="/contact" className="underline">
                  ask us
                </Link>{" "}
                and we will tell you exactly what is live where you need it.
              </p>
            )}
          </div>
        )}
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="The honest split"
          title="What needs someone to be in Nigeria"
          description="If you are buying from abroad for yourself rather than for a relative at home, this is the half that will sit unused until you visit."
        />
        <div className="mx-auto max-w-3xl space-y-3">
          {inNigeria.map((item) => (
            <div
              key={item.key}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-4"
            >
              <p className="text-sm font-medium text-charcoal-ink">
                {item.label}
              </p>
              <p className="mt-1 text-sm text-charcoal-ink/60">{item.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Not sure which plan fits?"
        description="If you are paying from abroad for a parent at home, you can also fund their care directly and see what every payment bought."
        primaryHref="/pricing"
        primaryLabel="See plans and prices"
        secondaryHref="/contact"
        secondaryLabel="Ask us about your state"
      />
    </>
  );
}
