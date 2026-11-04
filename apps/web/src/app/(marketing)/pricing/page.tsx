import type { Metadata } from "next";
import Link from "next/link";
import { employerSeatLine, employerSeatPriceLabel, LAB_TESTS_NOT_INCLUDED, membershipAutoRenews, membershipPriceLabel, paidProductName, refundWindowDays, renewalCopy } from "@/lib/marketing/membership";
import { Section, SectionHeading } from "../_components/section";
import { PricingFreeFeatures } from "../_components/pricing-free-features";
import { PricingLabelBadge } from "../_components/pricing-label";
import { CtaBand } from "../_components/cta-band";
import { TestimonialsSection } from "../_components/testimonials-section";
import { EmergencyNotice } from "../_components/emergency-notice";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { FoundingMembersStrip } from "../_components/founding-members-strip";
import { LAB_TESTS_WHERE, planCards, planFaq, SAFETY_STATEMENT } from "../_content/pricing-ladder";
import { ALWAYS_FREE, ALWAYS_FREE_NOTE, EMPLOYER_HMO_NOTE, NAIRA_ONLY_STATEMENT } from "../_content/pricing";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Two plans: Free, or Membership, a year of care with your care team and a monthly online meeting with a doctor, in naira. You see the price before you pay.",
  path: MARKETING_ROUTES.pricing,
});

export const revalidate = 3600;

/**
 * Two plans only (decisions T2-01, T2-05, T2-09, 2026-11-04): Free and Membership. Membership Plus is retired and is not offered here,
 * whatever marketing.membership_ladder_public says. The two figures on this page, the Membership price and the employer seat price,
 * come from versioned config (commerce.membership_prices) through lib/marketing/membership.ts, never typed.
 */
export default async function PricingPage() {
  const price = membershipPriceLabel();
  const seatPrice = employerSeatPriceLabel();
  const refundDays = refundWindowDays();
  const autoRenews = await membershipAutoRenews();
  const cards = planCards({ membership: `₦${price}` });
  const faq = planFaq(refundDays, autoRenews);
  /** FAQPage structured data for the pricing questions; eligible for rich results. */
  const pricingFaqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingFaqJsonLd) }} />
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Pricing"
          title={`Free, or ${paidProductName()}`}
          description={`Everything you do yourself in the app is free, with no time limit and no card required. ${paidProductName()} is a year of care with your care team, including one online meeting with a doctor each month.`}
        />
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm font-medium text-deep-forest">{NAIRA_ONLY_STATEMENT}</p>
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2" data-testid="plan-cards">
          {cards.map((card) => (
            <section key={card.id} aria-labelledby={`plan-${card.id}`} className="rounded-xl border border-brand-green/20 bg-white p-6">
              <h2 id={`plan-${card.id}`} className="font-heading text-xl font-semibold text-charcoal-ink">
                {card.name}
              </h2>
              <p className="mt-1 text-lg font-semibold text-charcoal-ink">{card.priceLine}</p>
              <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{card.summary}</p>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-charcoal-ink/80">
                {card.includes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {card.id === "membership" ? (
                <p className="mt-4 text-sm text-charcoal-ink/70">
                  {renewalCopy(autoRenews, refundDays).pricingBox} Refunds: within {refundDays} days of buying it. After that it cannot be refunded.
                </p>
              ) : null}
            </section>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-charcoal-ink/70" data-testid="lab-tests-note">{LAB_TESTS_NOT_INCLUDED}</p>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-charcoal-ink/70">{LAB_TESTS_WHERE}</p>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-charcoal-ink/70">{SAFETY_STATEMENT}</p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={MARKETING_ROUTES.contact}>Talk to us first</Link>
          </Button>
        </div>
        <p className="mt-6 text-center text-sm text-charcoal-ink/70">
          For more detail, read our{" "}
          <Link href={MARKETING_ROUTES.howPricingWorks} className="font-semibold text-brand-green underline underline-offset-2">
            No-Hidden-Cost Promise and how we compare to your HMO
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Free" title="What the free app gives you" />
        <PricingFreeFeatures />
      </Section>

      {/* The founding member offer: renders nothing unless it is open (see the component). */}
      <FoundingMembersStrip />

      <Section>
        <SectionHeading eyebrow="Always free" title="Free through other providers" />
        <div className="mx-auto max-w-2xl">
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{ALWAYS_FREE.feature}</h3>
              <PricingLabelBadge label={ALWAYS_FREE.label} />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{ALWAYS_FREE.description}</p>
          </div>
          <p className="mt-6 text-center text-sm text-charcoal-ink/70">{ALWAYS_FREE_NOTE}</p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Questions" title="Frequently asked questions" />
        <FaqAccordion items={faq} variant="minimal" />
      </Section>

      <Section>
        <SectionHeading eyebrow="Employers, HMOs & institutions" title="Covering a workforce or member population?" />
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-medium text-charcoal-ink" data-testid="employer-seat-line">{employerSeatLine(seatPrice)}</p>
          <p className="mt-3 text-charcoal-ink/70">{EMPLOYER_HMO_NOTE}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={`${MARKETING_ROUTES.contact}?source=corporate`}>Request an employer health plan</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`${MARKETING_ROUTES.contact}?source=hmo`}>Talk to us about HMO partnerships</Link>
            </Button>
          </div>
        </div>
      </Section>

      {/* Real, consented, published quotes only; renders nothing until there are some. */}
      <TestimonialsSection />

      <Section variant="sage" className="pb-24">
        <EmergencyNotice className="mb-10" />
        <CtaBand
          variant="gradient"
          title="Ready to get started?"
          description="Join TarragonHealth today, for yourself or for a family member."
          secondaryHref={MARKETING_ROUTES.contact}
          secondaryLabel="Talk to us first"
        />
      </Section>
    </>
  );
}
