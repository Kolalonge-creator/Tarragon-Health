import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { PricingFreeFeatures } from "../_components/pricing-free-features";
import { PricingServices } from "../_components/pricing-services";
import { fetchServicePriceOverrides } from "@/lib/marketing/plan-prices";
import { PricingLabelBadge } from "../_components/pricing-label";
import { CtaBand } from "../_components/cta-band";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import {
  ALWAYS_FREE,
  ALWAYS_FREE_NOTE,
  EMPLOYER_HMO_NOTE,
  getPricingFaq,
} from "../_content/pricing";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "The TarragonHealth app is free. You pay only for a doctor's time, per piece of work, in naira, with the exact price shown before you confirm. No hidden costs, nothing recurring.",
  path: MARKETING_ROUTES.pricing,
});

export const revalidate = 3600;

export default async function PricingPage() {
  const priceOverrides = await fetchServicePriceOverrides();
  // Resolved once and used for both the rendered FAQ and its JSON-LD, so the
  // structured data always quotes the same (live) prices as the visible page.
  const pricingFaq = getPricingFaq(priceOverrides);
  /** FAQPage structured data for the pricing questions; eligible for rich results. */
  const pricingFaqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pricingFaq.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingFaqJsonLd) }}
      />
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Pricing"
          title="The app is free. You pay for a doctor's time."
          description="Everything you can do yourself costs nothing, with no time limit and no card required. We charge only when a doctor does a specific piece of work for you, and you always see that price first."
        />
        {/* The early exit for somebody who came here for one blood test, not to
            read a pricing page. The Health Check is genuinely pay-once and the
            lab sets its own price, so sending them straight out of this page is
            the honest thing to do rather than a leak. */}
        <div className="mx-auto mb-10 max-w-2xl rounded-xl border border-clinical-navy/15 bg-clinical-navy/[0.04] px-5 py-4 text-center">
          <p className="text-sm font-semibold text-clinical-navy">
Just want one blood test? You do not need an account for that.
          </p>
          <p className="mt-1.5 text-sm text-charcoal-ink/75">
            You pay laboratories and pharmacies directly, at their price, for every test, including a
            one-off Health Check. We tell you what&apos;s worth doing and a doctor reads the result; we
            never set the price and never take a cut.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href={MARKETING_ROUTES.annualHealthCheck}>Book a one-off check instead</Link>
          </Button>
        </div>
        <PricingFreeFeatures />
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={MARKETING_ROUTES.contact}>Talk to us first</Link>
          </Button>
        </div>
        <p className="mt-6 text-center text-sm text-charcoal-ink/70">
          Want the full picture first? Read our{" "}
          <Link href={MARKETING_ROUTES.howPricingWorks} className="font-semibold text-brand-green underline underline-offset-2">
No-Hidden-Cost Promise, care vouchers, and how we compare to your HMO
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What costs money"
          title="A doctor's time, priced per piece of work"
          description="Nothing here is ever added on your behalf: you choose it, you see the price, you confirm, and it does not renew. Screening bundles arranged with our partner laboratory are priced separately, and you see that price before you confirm those too."
        />
        <PricingServices priceOverrides={priceOverrides} />
      </Section>

      <Section>
        <SectionHeading eyebrow="What's always free" title="Free, and not from us" />
        <div className="mx-auto max-w-2xl">
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
                {ALWAYS_FREE.feature}
              </h3>
              <PricingLabelBadge label={ALWAYS_FREE.label} />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              {ALWAYS_FREE.description}
            </p>
          </div>
          <p className="mt-6 text-center text-sm text-charcoal-ink/70">{ALWAYS_FREE_NOTE}</p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Questions"
          title="Frequently asked questions"
        />
        <div className="mx-auto grid max-w-4xl gap-4">
          {pricingFaq.map((faq) => (
            <details
              key={faq.question}
              className="group rounded-xl border border-charcoal-ink/10 bg-white p-5"
            >
              <summary className="cursor-pointer list-none font-heading text-lg font-semibold text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2">
                {faq.question}
                <span className="float-right ml-4 text-brand-green transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-charcoal-ink/70">{faq.answer}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Employers, HMOs & institutions" title="Covering a workforce or member population?" />
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-charcoal-ink/70">{EMPLOYER_HMO_NOTE}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={`${MARKETING_ROUTES.contact}?source=corporate`}>Request employer health plan</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`${MARKETING_ROUTES.contact}?source=hmo`}>Talk to us about HMO partnerships</Link>
            </Button>
          </div>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Ready to get started?"
          description="Join TarragonHealth today, for yourself or someone you love."
          secondaryHref={MARKETING_ROUTES.contact}
          secondaryLabel="Talk to us first"
        />
      </Section>
    </>
  );
}
