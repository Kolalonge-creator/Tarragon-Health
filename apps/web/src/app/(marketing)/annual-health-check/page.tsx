import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { Section, SectionHeading } from "../_components/section";
import { WhatWeMeasure } from "../_components/what-we-measure";
import { HowTestingWorks } from "../_components/how-testing-works";
import { StepsExplorer } from "../_components/steps-explorer";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Annual Health Check",
  description:
    "One day a year for your health: bloods, blood pressure, BMI and the screening that fits your age and sex. Use any lab you like, a doctor reads it.",
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
 *  - Card details: checkout is hosted by Paystack; the platform never
 *    receives or stores a card number.
 *
 * NOTE: this block intentionally does NOT repeat the "MDCN-registered
 * doctors" wording. The homepage TrustBand carried exactly that claim until
 * 2026-09-05, when it was corrected to describe the verification mechanism
 * instead; per the founder's 2026-09-25 decision a patient never sees an
 * MDCN/NMCN registration number, which Nigerian patients don't recognise as a
 * trust signal anyway — so don't reintroduce a credential-number claim here
 * either. Per the 2026-09-26 narrowing, speciality + years of experience live
 * only on a doctor's profile page (doctor/[staffId]), not inline
 * anywhere, including reviewed-by-doctor.tsx. The two CHECK constraints this
 * block's claims rely on (clinical_staff_active_requires_verification,
 * clinical_staff_no_self_verification) are still live and unchanged.
 */
const BOOKING_ASSURANCES = [
  {
    title: "A verified doctor reads it",
    body: "A clinician cannot review results here until another clinician has verified their licence, and nobody can verify their own. The database enforces this rule.",
  },
  {
    title: "You confirm the price first",
    body: "You choose the laboratory, see its exact price, and confirm before anything is charged. You can stop at any time before then.",
  },
  {
    title: "Your card details stay with Paystack",
    body: "Payment is handled by Paystack on its own checkout page. Your card number stays with Paystack and never reaches Tarragon, so we cannot lose it.",
  },
];

const WHATS_INCLUDED = [
  {
    title: "Blood sugar (HbA1c)",
    body: "This test shows your average blood sugar over the last three months. It is the earliest reliable warning sign of diabetes, often appearing years before symptoms.",
  },
  {
    title: "Cholesterol (lipid panel)",
    body: "This measures total cholesterol, LDL cholesterol, HDL cholesterol and triglycerides, which together indicate your risk of heart attack and stroke.",
  },
  {
    title: "Your cancer screening",
    body: "The screening that fits you: cervical screening for women, or prostate-specific antigen (PSA) testing for men aged 45 and over. It is chosen by your age and sex. Included from Advanced Screen up.",
  },
  {
    title: "Blood pressure and BMI",
    body: "Both are measured carefully and saved to your Tarragon record, so that next year's check has something reliable to compare against.",
  },
  {
    title: "A doctor walks you through it",
    body: "A 15-minute video consultation with a doctor, who checks your results against your history and explains them plainly: what is normal, what to watch, and what, if anything, to do next. Included on every tier.",
  },
  {
    title: "One record, year after year",
    body: "Your results are kept in your Health Passport instead of in a drawer. Changes across several years are often where early warnings first appear.",
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
    title: "One laboratory visit",
    body: "Your samples and measurements are taken in a single visit. We do not yet offer home sample collection.",
  },
  {
    step: 3,
    title: "A video consult with your doctor",
    body: "A doctor reads every result, then you have a 15-minute video call to go through it together. For most people the outcome is that everything is normal and the next check is due in a year.",
  },
  {
    step: 4,
    title: "A plan, if you need one",
    body: "If something needs attention, a doctor follows up within a day, and within 12 hours if it is critical. The doctor then helps you decide what to do next, using the same record, so you do not start again.",
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
            A car is serviced every year, and your health deserves the same regular attention. One
            laboratory visit covers blood sugar, cholesterol, blood pressure, BMI and the cancer
            screening that fits your age and sex. A doctor reviews all of it and it is kept on one record.
          </p>
          <p className="mt-4 font-heading text-2xl font-semibold text-charcoal-ink">
            We take no commission on your tests
            <span className="text-base font-normal text-charcoal-ink/60"> · you pay the laboratory directly · once a year</span>
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
            If you are already a member, book from the Prevention section of your dashboard.
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
              Six checks in one visit
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              These checks were chosen because they detect the conditions that quietly cause most
              avoidable illness in Nigeria: diabetes, heart disease and cancers found late. Blood
              sugar, cholesterol, blood pressure, BMI and the doctor consultation are included in
              every tier from Core Screen; cancer screening starts at Advanced Screen.
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
          eyebrow="What we measure"
          title="Every test, explained"
          description="Each test is listed by what it tells you about your body, with the tier that includes it and how often it is repeated."
        />
        <WhatWeMeasure />
      </Section>

      <Section variant="sage">
        <HowTestingWorks current="annual" />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Pick your level"
          title="Three levels of check"
          description="Each level includes everything in the one before it, and every level ends with a doctor going through your results with you."
        />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
          {[
            {
              name: "Core Screen",
              price: "You pay the lab, once",
              body: "A full cardiometabolic and organ-baseline workup (HbA1c, full lipid panel, full blood count, liver, kidney and thyroid function, urinalysis) plus HIV, Hepatitis B, and Hepatitis C screening, genotype and blood group (once), and a 15-minute doctor video consult to walk through your results.",
              highlight: true,
            },
            {
              name: "Advanced Screen",
              price: "You pay the lab, once",
              body: "Everything in Core Screen, plus the cancer screening that fits your age and sex (cervical screening or PSA), an ECG, and a personalised screening calendar.",
            },
            {
              name: "Comprehensive Screen",
              price: "You pay the lab, once",
              body: "Everything in Advanced Screen, plus imaging.",
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
          If you need only one test, the screenings recommended by the World Health Organization
          (cervical screening, HIV, hepatitis B and hepatitis C) can each be requested on their
          own and in confidence, as can a blood group and genotype check. Either way, take the
          request to any laboratory you like and pay them directly at their price. We do not set
          or quote a price.
        </p>
        <div className="mx-auto mt-6 max-w-2xl">
          <ConfidentialResultNotice />
        </div>
        <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-dashed border-charcoal-ink/15 bg-white/60 p-6 text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">Coming soon</p>
          <h3 className="mt-1 font-heading text-lg font-semibold text-charcoal-ink">
            Full Panel: additional tests on top of any tier
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
            Vitamin D, vitamin B12 and folate, iron studies, hs-CRP (a marker of inflammation), a
            coagulation profile (how well your blood clots) and a tumour marker screen suited to
            your age and sex, added to your next check as a one-time upgrade. We are holding it
            back until a Clinical Director approves the exact panel.
          </p>
          <p className="mt-3 text-sm text-charcoal-ink/60">
            If you want to look further, see{" "}
            <Link href={MARKETING_ROUTES.advancedDiagnostics} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              Advanced diagnostic imaging
            </Link>{" "}
            which is on the same waiting list.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="How it works" title="Booked in minutes, completed in a morning" />
        <StepsExplorer steps={HOW_IT_WORKS.map(({ title, body }) => ({ title, body }))} />
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            What to expect
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            In most years your check will simply confirm that you are well, and that is its purpose.
            If something does show up, finding it early usually means simpler and cheaper
            treatment, and your doctor will tell you clearly if it needs further investigation.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            If you want year-round support, <Link href={MARKETING_ROUTES.prevention} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">Your free screening calendar</Link> keeps
            your full screening and vaccination schedule running all year. Comprehensive Screen
            already includes the doctor video consultation that reviews all your results, so
            there is no separate review to buy.
          </p>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Before you book"
          title="What we promise"
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
          title="Book this year's check"
          description="One morning, once a year, and a doctor who explains where your health stands. There is no subscription and nothing renews: you pay once, and the app itself stays free."
          primaryHref="/signup?intent=health_check"
          primaryLabel="Book your check"
        />
      </Section>
    </>
  );
}
