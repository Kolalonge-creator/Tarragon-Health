import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { Section, SectionHeading } from "../_components/section";
import { HowTestingWorks } from "../_components/how-testing-works";
import { StepsExplorer } from "../_components/steps-explorer";
import { LAB_TESTS_WHERE } from "../_content/pricing-ladder";
import { LAB_TESTS_NOT_INCLUDED } from "@/lib/marketing/membership";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Annual Health Check",
  description:
    "Your yearly check, at any laboratory you choose: download a request form, pay the laboratory directly, upload the report, and a doctor reviews it.",
  path: MARKETING_ROUTES.annualHealthCheck,
});

/**
 * The yearly health check, laboratory-independent (Tarragon Health 2.0, decisions T2-01 and T2-02, 2026-11-04).
 *
 * Membership Plus and its yearly blood panel are retired, and Tarragon-run testing days are closed to new bookings. The yearly check
 * now works the same way as every other test: the Membership gives a personalised test schedule and a downloadable request form, the
 * member takes it to any reputable laboratory and pays the laboratory directly, uploads the report, a doctor reviews it, and it goes
 * into the health record and the trends. This page names no laboratory price ("contact the laboratory for current pricing"), no
 * testing day, no sample collection by Tarragon and no review turnaround time. The Membership price is on the pricing page, read from
 * versioned config.
 *
 * The trust block is narrower than the homepage TrustBand on purpose: every line is something the database or the payment integration
 * enforces. clinical_staff carries clinical_staff_active_requires_verification and clinical_staff_no_self_verification; checkout is
 * hosted by Paystack and the platform never receives a card number. No MDCN/NMCN registration number is shown anywhere (founder
 * decision 2026-09-25).
 */
const BOOKING_ASSURANCES = [
  {
    title: "A verified doctor reads it",
    body: "A clinician cannot review results here until another clinician has verified their licence, and nobody can verify their own. The database enforces this rule.",
  },
  {
    title: "You confirm the price first",
    body: "Membership is one price for a year, shown to you and confirmed before anything is taken. It does not renew unless you choose that.",
  },
  {
    title: "Your card details stay with Paystack",
    body: "Payment is handled by Paystack on its own checkout page. Your card number stays with Paystack and never reaches Tarragon, so we cannot lose it.",
  },
];

const WHAT_IT_COVERS = [
  {
    title: "A schedule made for you",
    body: "Your plan says which tests are due this year, based on your age, your history and any condition you have. Many adults are advised to check blood sugar, cholesterol, kidneys, liver and blood count.",
  },
  {
    title: "A request form you can download",
    body: "When a test is due, download the request form from the app. It names exactly what is needed, so the laboratory knows what to do.",
  },
  {
    title: "Any reputable laboratory",
    body: "Take the form to a laboratory you trust, near you. You pay the laboratory directly. Contact the laboratory for current pricing.",
  },
  {
    title: "Confidential screening",
    body: "Screening for HIV, hepatitis B and hepatitis C can be requested on its own and in confidence. The result is treated as confidential.",
  },
  {
    title: "Reviewed by a doctor",
    body: "Upload your report to the app and a doctor from your care team reviews it. You can talk it through at your monthly online meeting.",
  },
  {
    title: "One record, year after year",
    body: "Every report goes into your health record and your trends, instead of a drawer. Changes across several years are often where early warnings first appear.",
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Join Membership",
    body: "One price for a year of care with your care team. You see the price and confirm it before anything is taken. Laboratory tests are not included.",
  },
  {
    step: 2,
    title: "Download your request form",
    body: "When your yearly tests are due, we remind you, and you download the request form from the app.",
  },
  {
    step: 3,
    title: "Go to any reputable laboratory",
    body: "Choose a laboratory near you and pay the laboratory directly. Ask them whether you should fast beforehand.",
  },
  {
    step: 4,
    title: "Upload the report",
    body: "Upload the laboratory report to the app. A doctor reviews it, it goes into your health record and your trends, and your care team can go through it with you at your monthly meeting.",
  },
];

export default function AnnualHealthCheckPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Once a year, at a laboratory you choose
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Your yearly health check
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Your plan tells you which tests are due. You download a request form, take it to any
            reputable laboratory and pay the laboratory directly. Then you upload the report, a doctor
            reviews it, and it goes into your health record so that each year builds on the last.
          </p>
          <p className="mt-4 text-base text-charcoal-ink/70">{LAB_TESTS_NOT_INCLUDED}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={MARKETING_ROUTES.pricing}>See Membership</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.prevention}>Explore preventive health</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.screeningJourney}>See your Screening Journey</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Already a member? Your test schedule and request forms are in your dashboard.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto mb-10 grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              How the yearly check works
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Your tests, your laboratory, one record
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              The aim is to find the conditions that quietly cause most avoidable illness in Nigeria
              early: diabetes, heart disease, kidney and liver damage, and infections found late.
              Which tests you need depends on you, and your plan says which.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "annual-checklist",
              imageAlt: "A yearly test schedule, reviewed by a doctor and kept on one record",
            }}
          />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {WHAT_IT_COVERS.map((item) => (
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
        <SectionHeading eyebrow="How it works" title="Four steps, once a year" />
        <StepsExplorer steps={HOW_IT_WORKS.map(({ title, body }) => ({ title, body }))} />
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-charcoal-ink/70">{LAB_TESTS_WHERE}</p>
      </Section>

      <Section variant="sage">
        <HowTestingWorks current="annual" />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="On every plan"
          title="Any test, any laboratory, nothing added"
          description="We tell you which tests you need and write the request, you take it to any reputable laboratory you choose, and you pay the laboratory directly, at its price. Tarragon adds nothing to it."
        />
        <p className="mx-auto max-w-3xl text-center text-sm text-charcoal-ink/70">
          Your screening calendar is free on every plan. The screenings recommended by the World
          Health Organization (cervical screening, HIV, hepatitis B and hepatitis C) can each be
          requested on their own and in confidence, as can a blood group and genotype check. We do
          not set or quote a price for any of them.
        </p>
        <div className="mx-auto mt-6 max-w-2xl">
          <ConfidentialResultNotice />
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            What to expect
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            In most years your tests will simply confirm that you are well, and that is their purpose.
            If something does show up, finding it early usually means simpler and cheaper
            treatment, and a doctor will tell you clearly if it needs further investigation.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            If you want year-round support,{" "}
            <Link href={MARKETING_ROUTES.prevention} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              your free screening calendar
            </Link>{" "}
            keeps your full screening and vaccination schedule running all year, on every plan.
          </p>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Before you join"
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
          title="This year's check, with your care team"
          description="Your tests at a laboratory you choose, reviewed by a doctor and kept on one record. Membership is one price for the year, and the app itself stays free."
          primaryHref="/signup"
          primaryLabel="Create your free account"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="See pricing"
        />
      </Section>
    </>
  );
}
