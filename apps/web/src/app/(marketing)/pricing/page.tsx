import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { PricingTable } from "../_components/pricing-table";
import { PricingAddOns } from "../_components/pricing-addons";
import { PricingLabelBadge } from "../_components/pricing-label";
import { CtaBand } from "../_components/cta-band";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import {
  ALWAYS_FREE,
  ALWAYS_FREE_NOTE,
  BOOKING_STEPS,
  EMPLOYER_HMO_NOTE,
  NEVER_DO,
  PRICING_FAQ,
  PRICING_PROMISES,
} from "../_content/pricing";

export const metadata: Metadata = {
  title: "Pricing — TarragonHealth",
  description:
    "Transparent pricing for TarragonHealth plans in Nigeria (₦) and diaspora (£). No hidden costs — every line item is clearly labelled.",
};

export const revalidate = 3600;

export default function PricingPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple, transparent plans"
          description="Every line item carries exactly one label — included, book & pay, free elsewhere, or add-on. No hidden costs."
        />
        <PricingTable />
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Start monitoring</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={MARKETING_ROUTES.contact}>Talk to us first</Link>
          </Button>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Our promise" title="The No-Hidden-Cost Promise" />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {PRICING_PROMISES.map((promise) => (
            <div
              key={promise}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-5 text-sm leading-relaxed text-charcoal-ink/75"
            >
              {promise}
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Add-ons"
          title="Optional extras, fully explained"
          description="Nothing here is automatically added to your plan. You choose them, you see the price, you confirm."
        />
        <PricingAddOns />
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="What's always free" title="On any plan, including Free" />
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

      <Section>
        <SectionHeading eyebrow="How it works" title="Booking & paying, step by step" />
        <ol className="mx-auto grid max-w-3xl gap-6">
          {BOOKING_STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-semibold text-white"
                aria-hidden
              >
                {index + 1}
              </span>
              <div>
                <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
                  {step.title}
                </h3>
                <p className="mt-1 text-charcoal-ink/70">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-charcoal-ink/70">
          Nothing is ever taken from your card without you confirming that exact transaction first.
        </p>
      </Section>

      <Section variant="navy">
        <SectionHeading
          eyebrow="What we will never do"
          title="Trust, spelled out"
          invert
        />
        <ul className="mx-auto grid max-w-3xl gap-3">
          {NEVER_DO.map((item) => (
            <li
              key={item}
              className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm leading-relaxed text-white/80"
            >
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Questions"
          title="Frequently asked questions"
        />
        <div className="mx-auto grid max-w-4xl gap-4">
          {PRICING_FAQ.map((faq) => (
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
          description="Join TarragonHealth today — for yourself or someone you love."
          secondaryHref={MARKETING_ROUTES.contact}
          secondaryLabel="Talk to us first"
        />
      </Section>
    </>
  );
}
