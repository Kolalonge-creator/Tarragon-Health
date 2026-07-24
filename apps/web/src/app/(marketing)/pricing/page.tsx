import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { PricingTable } from "../_components/pricing-table";
import { PricingAddOns } from "../_components/pricing-addons";
import { PricingLabelBadge } from "../_components/pricing-label";
import { PlanFinder } from "../_components/plan-finder";
import { CtaBand } from "../_components/cta-band";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import {
  ALWAYS_FREE,
  ALWAYS_FREE_NOTE,
  BOOKING_STEPS,
  EMPLOYER_HMO_NOTE,
  HMO_COMPARE_INTRO,
  HMO_COMPARE_NOTE,
  HMO_COMPARE_ROWS,
  TYPICAL_PRICES,
  TYPICAL_PRICES_NOTE,
  FREE_TRIAL_INTRO,
  FREE_TRIAL_TERMS,
  FREE_TRIALS,
  NEVER_DO,
  PRICING_FAQ,
  PRICING_PROMISES,
} from "../_content/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Transparent pricing for TarragonHealth plans in Nigeria (₦) and diaspora (£). No hidden costs: every line item is clearly labelled.",
  alternates: { canonical: MARKETING_ROUTES.pricing },
};

export const revalidate = 3600;

/** FAQPage structured data for the pricing questions; eligible for rich results. */
const pricingFaqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: PRICING_FAQ.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export default function PricingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingFaqJsonLd) }}
      />
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple, transparent plans"
          description="Every line item carries exactly one label: included, book & pay, free elsewhere, or add-on. No hidden costs."
        />
        <PlanFinder />
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
          eyebrow="Try before you commit"
          title="Free trials of real clinical care"
          description={FREE_TRIAL_INTRO}
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {FREE_TRIALS.map((trial) => (
            <div
              key={trial.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-5"
            >
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">
                {trial.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{trial.body}</p>
            </div>
          ))}
        </div>
        <ul className="mx-auto mt-6 max-w-3xl space-y-2 text-center text-sm text-charcoal-ink/70">
          {FREE_TRIAL_TERMS.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Tarragon vs your HMO"
          title="Keep your HMO. Add the layer that watches."
          description={HMO_COMPARE_INTRO}
        />
        <div className="mx-auto max-w-3xl overflow-x-auto">
          <table className="w-full min-w-[32rem] border-separate border-spacing-0 overflow-hidden rounded-2xl border border-charcoal-ink/10 bg-white text-sm">
            <thead>
              <tr className="bg-warm-ivory text-left">
                <th scope="col" className="p-4 font-heading font-semibold text-charcoal-ink">
                  What you need
                </th>
                <th scope="col" className="p-4 text-center font-heading font-semibold text-charcoal-ink">
                  Your HMO
                </th>
                <th scope="col" className="p-4 text-center font-heading font-semibold text-charcoal-ink">
                  TarragonHealth
                </th>
              </tr>
            </thead>
            <tbody>
              {HMO_COMPARE_ROWS.map((row) => (
                <tr key={row.need} className="border-t border-charcoal-ink/10">
                  <td className="border-t border-charcoal-ink/10 p-4 text-charcoal-ink/80">{row.need}</td>
                  <td className="border-t border-charcoal-ink/10 p-4 text-center" aria-label={row.hmo ? "Covered by your HMO" : "Not covered by your HMO"}>
                    <span aria-hidden className={row.hmo ? "text-brand-green" : "text-charcoal-ink/30"}>
                      {row.hmo ? "✓" : "—"}
                    </span>
                  </td>
                  <td className="border-t border-charcoal-ink/10 p-4 text-center" aria-label={row.tarragon ? "Covered by TarragonHealth" : "Not covered by TarragonHealth"}>
                    <span aria-hidden className={row.tarragon ? "text-brand-green" : "text-charcoal-ink/30"}>
                      {row.tarragon ? "✓" : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          {HMO_COMPARE_NOTE}
        </p>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Add-ons"
          title="Optional extras, fully explained"
          description="Nothing here is automatically added to your plan. You choose them, you see the price, you confirm."
        />
        <PricingAddOns />
      </Section>

      <Section>
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

      <Section variant="sage">
        <SectionHeading
          eyebrow="Typical prices"
          title="What book &amp; pay items usually cost"
          description={TYPICAL_PRICES_NOTE}
        />
        <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
          {TYPICAL_PRICES.map((entry) => (
            <div
              key={entry.item}
              className="flex items-center justify-between gap-3 rounded-xl border border-charcoal-ink/10 bg-white px-5 py-4"
            >
              <span className="text-sm text-charcoal-ink/80">{entry.item}</span>
              <span className="shrink-0 text-sm font-semibold text-clinical-navy">{entry.price}</span>
            </div>
          ))}
        </div>
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
          description="Join TarragonHealth today, for yourself or someone you love."
          secondaryHref={MARKETING_ROUTES.contact}
          secondaryLabel="Talk to us first"
        />
      </Section>
    </>
  );
}
