import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ConfidentialResultNotice } from "@/components/confidential-result-notice";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { PanelTests } from "../_components/panel-tests";
import { Section, SectionHeading } from "../_components/section";
import { HowTestingWorks } from "../_components/how-testing-works";
import { StepsExplorer } from "../_components/steps-explorer";
import { PLUS_PANEL_WHERE, YEARLY_PANEL_TESTS } from "../_content/pricing-ladder";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Annual Health Check",
  description:
    "One blood panel a year, taken at a testing day you choose and read with your care team, included in Membership Plus. On other plans, use any laboratory.",
  path: MARKETING_ROUTES.annualHealthCheck,
});

/**
 * The yearly blood panel, as it actually exists.
 *
 * Founder decision 2026-11-03 (MS-04, docs/DECISIONS.md), on top of TT-4 and
 * T-3: the Core, Advanced and Comprehensive screens and the old annual
 * health check bundles are legacy and cannot be sold (a trigger refuses to
 * make one purchasable again). The one yearly panel that exists is the
 * Membership Plus panel: the tests in YEARLY_PANEL_TESTS, taken at a testing
 * day the member chooses from the open dates and venues (MS-03; Tarragon runs
 * no laboratory or clinic of its own), with results uploaded to the account
 * and read with the care team. This page describes
 * that, and only that. It names no tier, no imaging, no separate doctor
 * consultation and no price of its own: the price is on the pricing page,
 * read from versioned config.
 *
 * The trust block is still narrower than the homepage TrustBand on purpose:
 * every line is something the database or the payment integration enforces.
 * clinical_staff carries clinical_staff_active_requires_verification and
 * clinical_staff_no_self_verification; checkout is hosted by Paystack and the
 * platform never receives a card number. No MDCN/NMCN registration number is
 * shown anywhere (founder decision 2026-09-25).
 */
const BOOKING_ASSURANCES = [
  {
    title: "A verified doctor reads it",
    body: "A clinician cannot review results here until another clinician has verified their licence, and nobody can verify their own. The database enforces this rule.",
  },
  {
    title: "You confirm the price first",
    body: "Membership Plus is one price for a year, shown to you and confirmed before anything is taken. It does not renew unless you choose that.",
  },
  {
    title: "Your card details stay with Paystack",
    body: "Payment is handled by Paystack on its own checkout page. Your card number stays with Paystack and never reaches Tarragon, so we cannot lose it.",
  },
];

const WHATS_INCLUDED = [
  {
    title: "Blood sugar",
    body: "Fasting glucose and HbA1c, which shows your average blood sugar over the last three months. HbA1c is the earliest reliable warning sign of diabetes, often years before symptoms.",
  },
  {
    title: "Cholesterol and fats",
    body: "Total cholesterol, LDL, HDL and triglycerides, which together indicate your risk of heart attack and stroke.",
  },
  {
    title: "Kidneys, liver and blood count",
    body: "Creatinine, potassium and sodium for your kidneys; ALT and AST for your liver; haemoglobin, white cell count and platelets for your blood. A baseline that next year's check can be compared against.",
  },
  {
    title: "Infection screening",
    body: "HIV, hepatitis B and hepatitis C. These infections cause no symptoms for years and do the most damage when nobody is looking for them. The result is treated as confidential.",
  },
  {
    title: "Read with your care team",
    body: "Your results are uploaded to your account. A result outside the normal range is checked by a clinician first, and your care team goes through all of them with you on your monthly video call.",
  },
  {
    title: "One record, year after year",
    body: "Your results are kept in your Health Passport instead of in a drawer. Changes across several years are often where early warnings first appear.",
  },
];

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Join Membership Plus",
    body: "One price for a year of care with your care team, including the yearly blood panel. You see the price and confirm it before anything is taken.",
  },
  {
    step: 2,
    title: "Choose a date and location",
    body: "When your panel is due, the app shows you the testing days available, with their dates and locations. You pick the one that suits you, and we remind you before the day.",
  },
  {
    step: 3,
    title: "One visit",
    body: "Tarragon's team takes your samples in a single visit, and our partner laboratory tests them. Fast for nine to twelve hours beforehand for the cholesterol test; water is fine.",
  },
  {
    step: 4,
    title: "Your results, explained",
    body: "Your results are uploaded to your account. Anything outside the normal range is checked by a clinician first, and reaches a doctor within 24 hours, or within 12 hours if it is critical. Your care team then goes through everything with you on your monthly call.",
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
            The yearly blood panel
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Eighteen blood tests, once a year, taken at a testing day you choose and read with
            your care team. It covers blood sugar, cholesterol, your kidneys, liver and
            blood count, and screening for HIV and hepatitis, and it is kept on one record so that
            each year builds on the last.
          </p>
          <p className="mt-4 font-heading text-2xl font-semibold text-charcoal-ink">
            Included in Membership Plus
            <span className="text-base font-normal text-charcoal-ink/60"> · one price for the year · no renewal unless you choose it</span>
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={MARKETING_ROUTES.pricing}>See Membership Plus</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.prevention}>Explore preventive health</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.screeningJourney}>See your Screening Journey</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Already a member? Your panel is arranged from the Membership section of your dashboard.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto mb-10 grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              What is included
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Eighteen tests in one visit
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              These tests were chosen because they detect the conditions that quietly cause most
              avoidable illness in Nigeria: diabetes, heart disease, kidney and liver damage, and
              infections found late. Every one of them is in the panel; there are no levels to
              choose between.
            </p>
            <PanelTests groups={YEARLY_PANEL_TESTS} />
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "annual-checklist",
              imageAlt: "Eighteen tests, read with your care team, once a year",
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
        <SectionHeading eyebrow="How it works" title="Booked when it is due, completed in a morning" />
        <StepsExplorer steps={HOW_IT_WORKS.map(({ title, body }) => ({ title, body }))} />
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-charcoal-ink/70">{PLUS_PANEL_WHERE}</p>
      </Section>

      <Section variant="sage">
        <HowTestingWorks current="annual" />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="On Free and Membership"
          title="Any test, any laboratory, no commission"
          description="The yearly panel is the one test Tarragon arranges for you. Everything else, on every plan, works the same way: we tell you which tests you need and write the request, you take it to Synlab or any laboratory you choose, and you pay the laboratory directly at its price."
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
            In most years your panel will simply confirm that you are well, and that is its purpose.
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
          title="This year's panel, with your care team"
          description="One morning, once a year, and a care team who explain where your health stands. Membership Plus is one price for the year, and the app itself stays free."
          primaryHref="/signup"
          primaryLabel="Create your free account"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="See pricing"
        />
      </Section>
    </>
  );
}
