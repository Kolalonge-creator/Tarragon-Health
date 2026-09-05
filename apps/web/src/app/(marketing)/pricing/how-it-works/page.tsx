import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../../_components/section";
import { CtaBand } from "../../_components/cta-band";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import {
  BOOKING_STEPS,
  CARE_VOUCHER_INTRO,
  CARE_VOUCHER_POINTS,
  CHECKUP_COMPARE_INTRO,
  CHECKUP_COMPARE_NOTE,
  CHECKUP_COMPARE_ROWS,
  HMO_COMPARE_INTRO,
  HMO_COMPARE_NOTE,
  HMO_COMPARE_ROWS,
  FREE_TRIAL_INTRO,
  FREE_TRIAL_TERMS,
  FREE_TRIALS,
  NEVER_DO,
  PRICING_PROMISES,
} from "../../_content/pricing";

export const metadata: Metadata = pageMetadata({
  title: "How pricing works",
  description:
    "Our No-Hidden-Cost Promise, why there is nothing to trial, care vouchers, how Tarragon compares to your HMO, and booking step-by-step.",
  path: MARKETING_ROUTES.howPricingWorks,
});

export const revalidate = 3600;

export default function HowPricingWorksPage() {
  return (
    <>
      {/* Text hero, matching its parent /pricing (which has no photo hero
          either). This page used to borrow the HOMEPAGE's hero photograph
          because none had been sourced for it -- the same photograph then
          fronted three separate pages. Borrowing another page's hero is not
          a fallback; if a photograph is genuinely sourced for this page,
          swap PhotoBannerHero back in. */}
      <Section className="pt-20 pb-0">
        <SectionHeading
          as="h1"
          eyebrow="Pricing, in detail"
          title="How pricing works"
          description="The promise behind every price, why there is nothing to trial, care vouchers, how we compare to your HMO, and exactly what happens each time you book something."
        />
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={MARKETING_ROUTES.pricing}>Back to pricing</Link>
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
          eyebrow="Nothing to trial"
          title="It's simply free until you want a doctor"
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
          eyebrow="Flexible payment"
          title="Care vouchers"
          description={CARE_VOUCHER_INTRO}
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {CARE_VOUCHER_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-5"
            >
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">
                {point.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{point.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-charcoal-ink/70">
          Funding someone else&apos;s care from abroad or wanting to give Tarragon as a gift?{" "}
          <Link href={MARKETING_ROUTES.gift} className="font-semibold text-brand-green underline underline-offset-2">
            See how gifting works
          </Link>
          .
        </p>
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
                  <td className="border-t border-charcoal-ink/10 p-4 text-center">
                    <span aria-hidden className={row.hmo ? "text-brand-green" : "text-charcoal-ink/30"}>
                      {row.hmo ? "✓" : "—"}
                    </span>
                    <span className="sr-only">{row.hmo ? "Covered by your HMO" : "Not covered by your HMO"}</span>
                  </td>
                  <td className="border-t border-charcoal-ink/10 p-4 text-center">
                    <span aria-hidden className={row.tarragon ? "text-brand-green" : "text-charcoal-ink/30"}>
                      {row.tarragon ? "✓" : "—"}
                    </span>
                    <span className="sr-only">{row.tarragon ? "Covered by TarragonHealth" : "Not covered by TarragonHealth"}</span>
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
          eyebrow="Tarragon vs a one-off checkup"
          title="The result is the same. What happens next isn't."
          description={CHECKUP_COMPARE_INTRO}
        />
        <div className="mx-auto max-w-3xl overflow-x-auto">
          <table className="w-full min-w-[32rem] border-separate border-spacing-0 overflow-hidden rounded-2xl border border-charcoal-ink/10 bg-white text-sm">
            <thead>
              <tr className="bg-warm-ivory text-left">
                <th scope="col" className="p-4 font-heading font-semibold text-charcoal-ink">
                  What you need
                </th>
                <th scope="col" className="p-4 text-center font-heading font-semibold text-charcoal-ink">
                  One-off checkup
                </th>
                <th scope="col" className="p-4 text-center font-heading font-semibold text-charcoal-ink">
                  TarragonHealth
                </th>
              </tr>
            </thead>
            <tbody>
              {CHECKUP_COMPARE_ROWS.map((row) => (
                <tr key={row.need} className="border-t border-charcoal-ink/10">
                  <td className="border-t border-charcoal-ink/10 p-4 text-charcoal-ink/80">{row.need}</td>
                  <td className="border-t border-charcoal-ink/10 p-4 text-center">
                    <span aria-hidden className={row.oneOff ? "text-brand-green" : "text-charcoal-ink/30"}>
                      {row.oneOff ? "✓" : "—"}
                    </span>
                    <span className="sr-only">{row.oneOff ? "Included" : "Not included"}</span>
                  </td>
                  <td className="border-t border-charcoal-ink/10 p-4 text-center">
                    <span aria-hidden className={row.tarragon ? "text-brand-green" : "text-charcoal-ink/30"}>
                      {row.tarragon ? "✓" : "—"}
                    </span>
                    <span className="sr-only">{row.tarragon ? "Included" : "Not included"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          {CHECKUP_COMPARE_NOTE}
        </p>
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

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Ready to get started?"
          description="Join TarragonHealth today, for yourself or someone you love."
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="Back to pricing"
        />
      </Section>
    </>
  );
}
