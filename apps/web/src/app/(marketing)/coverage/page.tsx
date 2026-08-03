import type { Metadata } from "next";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { getServiceCoverage } from "@/lib/marketing/coverage-data";
import { itemsFor } from "@/lib/coverage/what-works-where";
import { CoverageChecker } from "./coverage-checker";

export const metadata: Metadata = {
  title: "Where TarragonHealth works: coverage by state",
  description:
    "Check which TarragonHealth services are live in any Nigerian state before you sign up, and see exactly what works from anywhere in the world.",
};

// The coverage answer changes only when ops contracts a partner or switches a
// state on, so a short cache is plenty and keeps the page fast for anon traffic.
export const revalidate = 300;

export default async function CoveragePage() {
  const coverage = await getServiceCoverage();
  const liveStates = coverage.filter((row) => row.isActive);
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
            when, write you a request to take to any lab you like, read the result with you, and
            follow up. None of that waits on us signing a partner in your state, so none of it is
            switched off where you live.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
            You pay the lab or the pharmacy directly, at their price. We take nothing on top.
          </p>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            What we do not yet do anywhere: collect a sample from your home, deliver medication to
            your door, or bill a lab on your behalf. Those need contracted partners, and we would
            rather say so than imply otherwise.
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
