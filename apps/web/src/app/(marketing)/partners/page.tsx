import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { TIER_COPY } from "@/lib/marketing/accountability-data";
import { PARTNER_LOGOS, PARTNER_VERIFICATION_PRINCIPLE } from "../_content/partners";
import { NAIRA_ONLY_STATEMENT } from "../_content/pricing";

export const metadata: Metadata = pageMetadata({
  title: "Our partners",
  description:
    "The real, current partnerships behind TarragonHealth, why we do not take capitation, how we price, and how referral to a doctor works.",
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
    title: "We are paid for the work we do",
    body: "A doctor's time, priced per piece of work you can see and confirm before it happens. If nothing was done, nothing was charged.",
  },
  {
    title: "Nothing to gain by doing less",
    body: "A fixed fee per member, paid whether or not anyone is seen, rewards doing less. We prefer to be paid for a review that took place rather than for a name on a list.",
  },
  {
    title: "It is simpler to explain, and easier to trust",
    body: "You can look at any bill and see exactly what it paid for. That is harder to promise when payment and care are no longer connected.",
  },
];

/**
 * Escalation teaser. Titles are derived from the shared TIER_COPY taxonomy
 * (accountability-data.ts) rather than re-typed, so a future edit to that
 * copy can't silently drift out of sync with this page — the same reasoning
 * that already keeps the SLA *number* off this page: /accountability reads
 * the live, signed escalation_slas config and is the one place that ever
 * states a figure (see accountability-data.ts's header comment on failing
 * soft and quiet rather than hardcoding one). This page links there instead
 * of repeating a number that could drift out of sync with it.
 */
const ESCALATION_TIER_ORDER = ["emergency", "urgent_escalation", "clinician_review"] as const;

const ESCALATION_POINT_BODIES: Record<(typeof ESCALATION_TIER_ORDER)[number], string> = {
  emergency:
    "Receives the shortest written response time we hold ourselves to, and the full emergency safety net regardless of what you have paid.",
  urgent_escalation:
    "An abnormal result or a concerning home reading has its own shorter response time. It does not wait behind routine cases.",
  clinician_review:
    "Still has a maximum, signed response time. Nothing waits in a queue without a limit, and silence is never assumed to be safe.",
};

const ESCALATION_POINTS = ESCALATION_TIER_ORDER.map((tier) => ({
  title: TIER_COPY[tier]?.label ?? tier,
  body: ESCALATION_POINT_BODIES[tier],
}));

export default function PartnersPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Trust & partners"
          title="Who we actually work with"
          description="An account of our real partnerships, why we do not take capitation, how we price, and what happens when something in your record needs a doctor's attention."
        />
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Named partners"
          title="Who we work with"
          description={
            PARTNER_LOGOS.length > 0
              ? "Every name below is a real, current and signed relationship, not a logo placed for effect."
              : PARTNER_VERIFICATION_PRINCIPLE
          }
        />
        {/* Same "dormant until real" discipline as partner-logo-strip.tsx: if
            PARTNER_LOGOS is ever empty (a partner roster has changed more
            than once in this project's history — see CLAUDE.md's laboratory
            fulfilment section), this page says so honestly instead of
            rendering a "here is who we work with" heading over nothing. */}
        {PARTNER_LOGOS.length > 0 ? (
          <>
            {/* flex-wrap, not a fixed-column grid: a lone confirmed partner
                (the current, real count) should sit centered, not stranded
                in the first cell of a two-column grid built for a count this
                page does not have yet. */}
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
          </>
        ) : (
          <p className="mx-auto max-w-2xl rounded-2xl border border-charcoal-ink/15 bg-white p-6 text-center text-sm text-charcoal-ink/70">
            We do not have a signed partner that has agreed to be named at the moment. Please check again later, or{" "}
            <Link href={MARKETING_ROUTES.contact} className="underline">
              ask us
            </Link>{" "}
            and we will tell you what is in place today.
          </p>
        )}
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Most of what Tarragon does needs no partner at all. You can take a test request to any
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
          eyebrow="How we are paid"
          title="Why we do not take capitation"
          description="Some healthcare businesses are paid a fixed fee per member, whether or not that member is seen. We have chosen not to work this way."
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
          <p className="text-sm font-semibold text-clinical-navy">{NAIRA_ONLY_STATEMENT}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={MARKETING_ROUTES.howPricingWorks}>Read the full No-Hidden-Cost Promise</Link>
          </Button>
        </div>
      </Section>

      <Section variant="navy">
        <SectionHeading
          invert
          eyebrow="What happens if something is wrong"
          title="How referral to a doctor works"
          description="Every case that reaches a doctor's queue has a maximum response time that we have written down and signed. The time depends on how urgent the case appears, so there is not one figure for every case."
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
          description="We would rather answer a difficult question before you sign up than after."
          secondaryHref={`${MARKETING_ROUTES.contact}?source=partners`}
          secondaryLabel="Ask us directly"
        />
      </Section>
    </>
  );
}
