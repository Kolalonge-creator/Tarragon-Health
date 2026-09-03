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
    "Whole-body and targeted imaging referrals for people who want to look further than routine screening goes, coordinated by Tarragon and read by your doctor. Coming soon.",
  path: MARKETING_ROUTES.advancedDiagnostics,
});

const WHAT_THIS_IS = [
  {
    title: "A referral, not a scanner we own",
    body: "Tarragon doesn't buy or run imaging equipment. This will work the same way our lab network already does: we tell you which scan fits what you're asking, connect you with an imaging partner, and you pay that partner directly for the scan itself.",
  },
  {
    title: "A doctor reads it with you",
    body: "Whatever comes back goes into your Tarragon record and gets read by a doctor against your actual history, not handed to you as a stack of images and a radiology report you're left to interpret alone.",
  },
  {
    title: "For looking further, not for worry",
    body: "This sits alongside your Annual Health Check and screening calendar, for people who want a broader look than routine screening covers. It's not a replacement for either, and it's not something to reach for out of anxiety rather than a real conversation with your doctor first.",
  },
];

const HONEST_EXPECTATIONS = [
  {
    title: "No imaging partner is signed yet",
    body: "We're not going to advertise a service we can't actually deliver. This page exists so you can tell us you're interested before there's anything to book.",
  },
  {
    title: "You'll always pay the imaging provider, not us",
    body: "The same self-arranged-fulfilment principle as our lab network: whatever this costs is set by the imaging partner, not marked up by Tarragon. Our part is coordination and the doctor's read.",
  },
  {
    title: "We'll say so before it's real",
    body: "Everything above is the plan, not a live product. If you join the list below, we'll tell you honestly when there's an actual partner and a real price, not before.",
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
            For people who want to look further than routine bloodwork and screening go: a
            whole-body or targeted imaging referral, coordinated through Tarragon and read by
            your doctor against the record you already have with us.
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
          title="A referral relationship, not a Tarragon-owned scanner"
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
        <SectionHeading eyebrow="Before you get excited" title="What we can actually promise you today" />
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
          title="Want to know when this is real?"
          description="Tell us you're interested and we'll follow up personally once there's an actual imaging partner and a real price, not before."
          primaryHref={`${MARKETING_ROUTES.contact}?source=advanced-diagnostics`}
          primaryLabel="Join the waitlist"
        />
      </Section>
    </>
  );
}
