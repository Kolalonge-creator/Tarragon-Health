import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Annual Health Check",
  description:
    "One day a year for your health: bloods, blood pressure, BMI, and the cancer screening that fits your age and sex, reviewed by a doctor, at a partner lab near you. ₦65,000, available to anyone on any plan.",
  alternates: { canonical: MARKETING_ROUTES.annualHealthCheck },
};

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
 * "MDCN-registered doctors" wording. At the time of writing the only active
 * clinical_staff record has credential_number null (the founder deferred
 * recording it, see CLAUDE.md 2026-07-30), so that claim is not currently
 * backed by data and must not be spread to a second page until it is.
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
    body: "The one that fits you: cervical screening for women, prostate (PSA) for men over 40, chosen by age and sex, not one-size-fits-all.",
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
    body: "Pick a partner lab near you and confirm: the price is shown before you pay, and it's the price you pay.",
  },
  {
    step: 2,
    title: "One lab visit",
    body: "Samples and measurements in a single visit. Home sample collection is coming to selected areas.",
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
            From ₦15,000
            <span className="text-base font-normal text-charcoal-ink/60"> · once a year · anyone, on any plan (even Free)</span>
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
        <SectionHeading
          eyebrow="What's included"
          title="Six things, one visit"
          description="Chosen because they catch the conditions that quietly account for most avoidable illness in Nigeria: diabetes, heart disease, and late-found cancers."
        />
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
          title="Three packages, one discipline"
          description="Every package follows World Health Organization screening guidance for what actually matters in Nigeria, and every one ends with a doctor talking you through your results."
        />
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-3">
          {[
            {
              name: "Basic",
              price: "₦15,000",
              body: "The cardiometabolic essentials: HbA1c, full cholesterol panel, blood pressure, and BMI. These are the WHO's core adult checks.",
            },
            {
              name: "Annual Health Check",
              price: "₦65,000",
              body: "Everything in Basic, plus the cancer screening that fits your age and sex (cervical screening or PSA).",
              highlight: true,
            },
            {
              name: "Comprehensive",
              price: "₦75,000",
              body: "Everything in the Annual Health Check, plus HIV, Hepatitis B, and Hepatitis C screening, all WHO priorities for Nigeria.",
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
          Hepatitis B, and Hepatitis C) can each be booked on their own, confidentially, from
          ₦6,000. Don&apos;t know your blood group and genotype yet? You can book that directly
          too, from ₦6,500.
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
            than waiting for symptoms. The Annual Health Check is a screening day, not a
            hospital admission: if anything needs deeper investigation, your doctor will say so
            plainly and help you arrange it.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Looking for the year-round version? <Link href={MARKETING_ROUTES.pricing} className="text-brand-green hover:underline">Tarragon Prevent</Link> keeps
            your full screening and vaccination calendar running all year, and the{" "}
            <Link href={MARKETING_ROUTES.pricing} className="text-brand-green hover:underline">
              Annual Doctor Review
            </Link>{" "}
            adds a video consult reviewing your whole year of care.
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
