import type { Metadata } from "next";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { getServiceCoverage } from "@/lib/marketing/coverage-data";
import { gatedServices, itemsFor } from "@/lib/coverage/what-works-where";
import { CoverageChecker } from "./coverage-checker";
import { pageMetadata } from "@/lib/marketing/site";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

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
  // row.isActive is the state's own master rollout switch, which can be on
  // with zero partners actually contracted there. Filtering on it alone would
  // claim "partner-fulfilled services are live" in a state where the checker
  // below correctly says otherwise. Only a state with at least one currently-
  // gated service actually live belongs in this list — see gatedServices().
  // Since the 2026-08-25 lab-partner-fulfilment restoration, that now
  // includes lab tests (Synlab Nigeria, contracted nationwide) alongside home
  // sample collection and medication delivery, so every state now qualifies
  // through lab tests alone even though the other two remain unlive anywhere.
  const gated = gatedServices();
  const liveStates = coverage.filter((row) => gated.some((service) => row.services[service]));
  const allStatesLive = coverage.length > 0 && liveStates.length === coverage.length;
  const inNigeria = itemsFor("in_nigeria");

  return (
    <>
      <Section className="pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-heading text-4xl font-bold text-charcoal-ink sm:text-5xl">
            Where we work
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            TarragonHealth works anywhere in Nigeria. We tell you which tests are worth doing and
            when, book them directly with Synlab Nigeria, our nationwide partner lab, read the
            result with you, and follow up. Synlab is contracted in every state, so lab tests are
            never switched off where you live.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
            You see the exact price and confirm before we bill you for a lab test. Pharmacy
            purchases are still yours to arrange: you pay the pharmacy directly, at their price,
            and we take nothing on top.
          </p>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            What we do not yet do anywhere: collect a sample from your home, or deliver medication
            to your door. Both still need a contracted logistics partner, and we would rather say
            so than imply otherwise.
          </p>
          {allStatesLive ? (
            <p className="mt-4 text-sm text-charcoal-ink/60">
              Partner-fulfilled lab tests are live nationwide, through Synlab Nigeria, in every
              state and the FCT.
            </p>
          ) : liveStates.length > 0 ? (
            <p className="mt-4 text-sm text-charcoal-ink/60">
              Partner-fulfilled services are live in{" "}
              <span className="font-medium text-deep-forest">
                {liveStates.map((row) => row.displayName).join(", ")}
              </span>
              .
            </p>
          ) : null}
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
              <p className="text-sm font-medium text-charcoal-ink">{item.label}</p>
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
