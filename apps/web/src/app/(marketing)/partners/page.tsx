import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { PARTNER_LOGOS, PARTNER_VERIFICATION_PRINCIPLE } from "../_content/partners";

export const metadata: Metadata = pageMetadata({
  title: "Our partners",
  description:
    "The real, current partnerships behind TarragonHealth, why we won't take capitation, how we price, and how escalation actually works.",
  path: MARKETING_ROUTES.partners,
});

/**
 * Capitation philosophy, founder decision I8 (CLAUDE.md: "no capitation,
 * ever"). Written for a patient audience, not a pitch deck: no competitor
 * named, no comparison baiting, framed as a considered choice rather than a
 * gap. Keep this positively framed if it's ever extended, per the same
 * "avoid curt-negative marketing tone" rule trust-pillars.tsx already follows.
 */
const CAPITATION_REASONS = [
  {
    title: "We're paid for what we actually do",
    body: "A doctor's time, priced per piece of work you can see and confirm before it happens. If nothing was done, nothing was charged.",
  },
  {
    title: "Nothing to gain by doing less",
    body: "A fixed fee per member, paid whether or not anyone is actually seen, quietly rewards doing less. We'd rather be paid for the review that happened than for a name on a list.",
  },
  {
    title: "It's simpler to explain, and to trust",
    body: "You can look at any bill and see exactly what it paid for. That's harder to promise under an arrangement where payment and care are no longer connected.",
  },
];

/**
 * Escalation teaser, deliberately unquantified here — /accountability reads
 * the live, signed escalation_slas config and is the one place that ever
 * states a number (see accountability-data.ts's header comment on failing
 * soft and quiet rather than hardcoding a figure). This page links there
 * instead of repeating a number that could drift out of sync with it.
 */
const ESCALATION_POINTS = [
  {
    title: "Something that could be dangerous now",
    body: "Gets the fastest, written ceiling we hold ourselves to, and the full emergency safety net regardless of what you've paid.",
  },
  {
    title: "Something that needs a doctor soon",
    body: "An abnormal result or a concerning home reading gets its own shorter ceiling. It doesn't wait behind routine cases.",
  },
  {
    title: "Everything else that needs a look",
    body: "Still has a maximum, signed response time. Nothing sits in an unbounded queue, and silence is never assumed to be safe.",
  },
];

export default function PartnersPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Trust & partners"
          title="Who we actually work with"
          description="A short, honest account of our real partnerships, why we won't take capitation, how we price, and what happens when something in your record needs a doctor's attention."
        />
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Named partners"
          title="Who we work with"
          description="Every name below is a real, current, signed relationship, not a logo placed for effect."
        />
        {/* flex-wrap, not a fixed-column grid: a lone confirmed partner (the
            current, real count) should sit centered, not stranded in the
            first cell of a two-column grid built for a count this page
            doesn't have yet. */}
        <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-6">
          {PARTNER_LOGOS.map((partner) => (
            <Card key={partner.name} className="w-full max-w-sm">
              <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
                <Image
                  src={partner.logoSrc}
                  alt={partner.name}
                  width={160}
                  height={56}
                  className="h-10 w-auto"
                />
                {partner.summary ? (
                  <p className="text-sm leading-relaxed text-charcoal-ink/70">{partner.summary}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          {PARTNER_VERIFICATION_PRINCIPLE}
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Most of what Tarragon does needs no partner at all: you can take a test request to any
          laboratory you choose, anywhere in Nigeria. See{" "}
          <Link
            href={MARKETING_ROUTES.coverage}
            className="font-semibold text-brand-green underline underline-offset-2"
          >
            where our contracted partners actually are
          </Link>
          .
        </p>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="How we're paid"
          title="Why we don't take capitation"
          description="Some healthcare businesses are paid a fixed fee per member, whether that member is seen or not. We've chosen not to."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {CAPITATION_REASONS.map((reason) => (
            <div key={reason.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">
                {reason.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{reason.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="How we price" title="Priced only in Naira" />
        <div className="mx-auto max-w-2xl rounded-xl border border-clinical-navy/15 bg-clinical-navy/[0.04] px-5 py-4 text-center">
          <p className="text-sm font-semibold text-clinical-navy">
            Every price is in Naira, always.
          </p>
          <p className="mt-1.5 text-sm text-charcoal-ink/75">
            There is no dollar version, no exchange-rate conversion, and no different price
            depending on where in the world you&apos;re paying from. One price list, in the
            currency you actually spend.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={MARKETING_ROUTES.howPricingWorks}>Read the full No-Hidden-Cost Promise</Link>
          </Button>
        </div>
      </Section>

      <Section variant="navy">
        <SectionHeading
          invert
          eyebrow="What happens if something's wrong"
          title="How escalation actually works"
          description="Every case that reaches a doctor's queue carries a maximum response time we've written down and signed, tiered by how urgent it looks, not one number for every case."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {ESCALATION_POINTS.map((point) => (
            <div key={point.title} className="rounded-xl border border-white/15 bg-white/5 p-6">
              <h3 className="font-heading text-base font-semibold text-white">{point.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{point.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-white/70">
          <Link
            href={MARKETING_ROUTES.accountability}
            className="font-medium text-white underline-offset-2 hover:underline"
          >
            See our exact response-time commitments, and who signed them
          </Link>
          .
        </p>
      </Section>

      <Section className="pb-24">
        <CtaBand
          variant="gradient"
          title="Questions about how we work?"
          description="We'd rather answer a hard question before you sign up than after."
          secondaryHref={`${MARKETING_ROUTES.contact}?source=partners`}
          secondaryLabel="Ask us directly"
        />
      </Section>
    </>
  );
}
