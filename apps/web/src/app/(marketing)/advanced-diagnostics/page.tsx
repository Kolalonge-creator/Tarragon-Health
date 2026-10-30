import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Advanced Diagnostics",
  description:
    "Whole-body and targeted imaging referrals for people who want to look further than routine screening goes, coordinated by us and read by a doctor.",
  path: MARKETING_ROUTES.advancedDiagnostics,
});

const WHAT_THIS_IS = [
  {
    title: "A referral, not a scanner we own",
    body: "Tarragon does not buy or run imaging equipment. This will work in the same way as our laboratory network: we tell you which scan suits your question, connect you with an imaging partner, and you pay that partner directly.",
  },
  {
    title: "A doctor reads it with you",
    body: "The result is added to your Tarragon record and read by a doctor against your history, so you are not left to interpret a report alone.",
  },
  {
    title: "For a broader look, not for reassurance",
    body: "This sits alongside your Annual Health Check and screening calendar. It gives a broader look and does not replace either. If you are worried about a symptom, talk to a doctor first rather than ordering a scan.",
  },
];

const HONEST_EXPECTATIONS = [
  {
    title: "No imaging partner has signed yet",
    body: "We will not advertise a service that we cannot deliver. This page exists so that you can tell us you are interested before there is anything to book.",
  },
  {
    title: "You will pay the imaging provider, not Tarragon",
    body: "The same principle applies as in our laboratory network: the cost is set by the imaging partner and is not marked up by Tarragon. Our part is coordination and the doctor's review of the result.",
  },
  {
    title: "We will tell you before it is available",
    body: "Everything above describes a plan, not a live service. If you join the list below, we will tell you when there is an actual partner and a confirmed price, and not before.",
  },
];

export default function AdvancedDiagnosticsPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Coming soon
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Advanced diagnostic imaging
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            For people who want to look further than routine blood tests and screening: a
            whole-body or targeted imaging referral, coordinated through Tarragon and reviewed by
            a doctor against the record you already have with us.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={`${MARKETING_ROUTES.contact}?source=advanced-diagnostics`}>
                Join the waitlist
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.annualHealthCheck}>See the Annual Health Check</Link>
            </Button>
          </div>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What this will be"
          title="A referral arrangement, not a Tarragon-owned scanner"
        />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
          {WHAT_THIS_IS.map((item) => (
            <div key={item.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Before you sign up" title="What we can promise today" />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {HONEST_EXPECTATIONS.map((item) => (
            <div key={item.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-5">
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Would you like to know when this is available?"
          description="Tell us you are interested and we will contact you personally once there is an imaging partner and a confirmed price, and not before."
          primaryHref={`${MARKETING_ROUTES.contact}?source=advanced-diagnostics`}
          primaryLabel="Join the waitlist"
        />
      </Section>
    </>
  );
}
