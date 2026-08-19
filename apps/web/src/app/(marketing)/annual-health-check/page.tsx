import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Annual Health Check",
  description:
    "One day a year for your health: bloods, blood pressure, BMI, and the cancer screening that fits your age and sex. We say what to get and why, you use any lab you like, and a doctor reads the result with you.",
  path: MARKETING_ROUTES.annualHealthCheck,
});

/**
 * The trust block for the page where somebody actually decides to hand over
 * money and a blood sample. Deliberately narrower than the homepage TrustBand:
 * every line below is something the database or the payment integration
 * enforces, checked live before it was written.
 *
 *  - Licence check: clinical_staff carries two CHECK constraints,
 *    clinical_staff_active_requires_verification (a record cannot be `active`
 *    unless license_verified_at is set) and clinical_staff_no_self_verification
 *    (verified_by can never equal the record's own profile_id).
 *  - Price: lab_orders are created pending_payment at the bundle's own
 *    price_kobo, and no charge happens until the patient completes hosted
 *    checkout, so "nothing is taken before you confirm" is structurally true.
 *  - Card details: checkout is hosted by Paystack/Stripe; the platform never
 *    receives or stores a card number.
 *
 * NOTE: this block intentionally does NOT repeat the homepage TrustBand's
 * "MDCN-registered doctors" wording. Re-checked live 2026-08-05: of 7 active
 * clinical_staff records, 6 carry a credential_number and a distinct
 * verified_by (all still QA test values — TEST-0001 etc, not real MDCN
 * numbers), and 1 has both credential_number and verified_by null (an older
 * record; license_verified_at is set, so it does not violate
 * clinical_staff_active_requires_verification, but nothing proves "someone
 * else" verified it, only that clinical_staff_no_self_verification's
 * `verified_by IS NULL OR ... verified_by <> profile_id` check trivially
 * allows a null verifier). The two CHECK constraints this block's claims rely
 * on are still live and unchanged. Still no real MDCN-registered doctor on
 * the platform, so still don't add the stronger wording here.
 */
const BOOKING_ASSURANCES = [
  {
    title: "A verified doctor reads it",
    body: "No one can review results here until someone else has verified their licence. The database refuses to make a clinician active otherwise, and nobody can verify their own.",
  },
  {
    title: "You confirm the price first",
    body: "You pick the lab, see its exact price, and confirm before anything is charged. Nothing is taken while your booking sits unpaid, and you can simply walk away.",
  },
  {
    title: "We never see your card",
    body: "Payment is handled by Paystack or Stripe on their own checkout. Your card number never reaches Tarragon, so it is not ours to lose.",
  },
];

const WHATS_INCLUDED = [
  {
    title: "Blood sugar (HbA1c)",
    body: "Your three-month blood sugar average: the earliest reliable warning sign for diabetes, years before symptoms.",
  },
  {
    title: "Cholesterol (lipid panel)",
    body: "Total, LDL, HDL, and triglycerides: the numbers behind heart-attack and stroke risk.",
  },
  {
    title: "Your cancer screening",
    body: "The one that fits you: cervical screening for women, prostate (PSA) for men over 40, chosen by age and sex, not one-size-fits-all. Included from Advanced Screen up.",
  },
  {
    title: "Blood pressure & BMI",
    body: "Measured properly and recorded to your Tarragon record, so next year has something real to compare against.",
  },
  {
    title: "A doctor reads every result",
    body: "Checked against your history, and explained plainly: what's fine, what to watch, and what, if anything, to do next.",
  },
  {
    title: "One record, year after year",
    body: "Results live in your Health Passport, not a drawer. Trends across years are where early warnings actually show up.",
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Book in the app",
    body: "Take your request to any laboratory you like. You pay them directly, at their price, and we take nothing on it.",
  },
  {
    step: 2,
    title: "One lab visit",
    body: "Samples and measurements in a single visit. We don't yet collect a sample from your home anywhere; that needs a contracted logistics partner, and we'd rather say so than imply otherwise.",
  },
  {
    step: 3,
    title: "Doctor reviews your results",
    body: "Every result is read by a doctor. Most people get the best news there is: all clear, see you next year.",
  },
  {
    step: 4,
    title: "A plan, if you need one",
    body: "If something needs attention, your doctor follows up the same day and helps you decide what's next, on the same record, with no starting over.",
  },
];

export default function AnnualHealthCheckPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            One day a year for your health
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            The Annual Health Check
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            You service your car every year. Your health deserves the same discipline. One lab
            visit covers your blood sugar, cholesterol, blood pressure, BMI, and the cancer
            screening that fits your age and sex, all reviewed by a doctor, all kept on one
            record.
          </p>
          <p className="mt-4 font-heading text-2xl font-semibold text-charcoal-ink">
            We take nothing on your tests
            <span className="text-base font-normal text-charcoal-ink/60"> · you pay the lab directly · once a year</span>
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup?intent=health_check">Book your check</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.prevention}>Explore preventive health</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.screeningJourney}>See your Screening Journey</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Already a member? Book directly from your dashboard&apos;s Prevention section.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto mb-10 grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              What&apos;s included
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Six things, one visit
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Chosen because they catch the conditions that quietly account for most avoidable
              illness in Nigeria: diabetes, heart disease, and late-found cancers. Blood sugar,
              cholesterol, BP &amp; BMI, and a doctor&apos;s read are on every tier below, starting
              with Core Screen; cancer screening is added on Advanced Screen.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "annual-checklist",
              imageAlt: "Six checks, reviewed by a doctor, once a year",
            }}
          />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {WHATS_INCLUDED.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Pick your level"
          title="Three tiers, one discipline"
          description="Each tier includes everything in the one before it, and every one ends with a doctor talking you through your results."
        />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
          {[
            {
              name: "Core Screen",
              price: "With a paid plan",
              body: "A full cardiometabolic and organ-baseline workup (HbA1c, full lipid panel, full blood count, liver/kidney/thyroid function, urinalysis) plus HIV, Hepatitis B, and Hepatitis C screening, genotype and blood group (once).",
              highlight: true,
            },
            {
              name: "Advanced Screen",
              price: "With a paid plan",
              body: "Everything in Core Screen, plus the cancer screening that fits your age and sex (cervical screening or PSA), an ECG, and a personalised screening calendar.",
            },
            {
              name: "Comprehensive Screen",
              price: "With a paid plan",
              body: "Everything in Advanced Screen, plus imaging, a syphilis screen, and a 15-minute doctor video consult to walk through your whole result set.",
            },
          ].map((tier) => (
            <div
              key={tier.name}
              className={
                tier.highlight
                  ? "rounded-xl border-2 border-brand-green bg-white p-6"
                  : "rounded-xl border border-charcoal-ink/10 bg-white p-6"
              }
            >
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{tier.name}</h3>
              <p className="mt-1 font-heading text-2xl font-bold text-brand-green">{tier.price}</p>
              <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{tier.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-charcoal-ink/70">
          Need just one thing? The WHO-recommended screenings (cervical screening, HIV,
          Hepatitis B, and Hepatitis C) can each be requested on their own, confidentially.
          Don&apos;t know your blood group and genotype yet? You can request that directly too.
          Either way, you take the request to any laboratory you like and pay them directly, at
          their price; we don&apos;t set or quote one.
        </p>
        <div className="mx-auto mt-6 max-w-2xl">
          <ConfidentialResultNotice />
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="How it works" title="Booked in minutes, done in a morning" />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <p className="font-heading text-2xl font-bold text-brand-green">{item.step}</p>
              <h3 className="mt-2 font-heading text-base font-semibold text-charcoal-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            Honest expectations
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Most years, your check will confirm you&apos;re well; that&apos;s the point, and
            it&apos;s worth paying for. For the few people whose results show something, catching
            it at an annual check typically means simpler, cheaper, more successful treatment
            than waiting for symptoms. This is a screening day, not a hospital admission: if
            anything needs deeper investigation, your doctor will say so plainly and help you
            arrange it.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Looking for the year-round version? <Link href={MARKETING_ROUTES.pricing} className="text-brand-green hover:underline">Tarragon Prevent</Link> keeps
            your full screening and vaccination calendar running all year. Comprehensive Screen
            already includes the doctor video consult reviewing your whole result set, so
            there&apos;s no separate review to buy.
          </p>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Before you book"
          title="What we can actually promise you"
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {BOOKING_ASSURANCES.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-5"
            >
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
          title="Book this year's check."
          description="One morning, once a year, and a doctor who tells you where you stand. No subscription needed: it is pay-once, on any plan including the free one."
          primaryHref="/signup?intent=health_check"
          primaryLabel="Book your check"
        />
      </Section>
    </>
  );
}
