import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { EmergencyNotice } from "../_components/emergency-notice";
import { Section, SectionHeading } from "../_components/section";
import { ScreeningJourney } from "../_components/screening-journey";
import { HowTestingWorks } from "../_components/how-testing-works";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Screening Journey",
  description:
    "See which screenings are recommended for your age and sex, then walk through each one: what it is for, where to get it, and how the result comes back.",
  path: MARKETING_ROUTES.screeningJourney,
});

const GENERAL_STEPS = [
  {
    title: "Know what's recommended",
    body: "Pick your age and sex below, or sign up and let your real profile (age, sex, family history) build your personal screening calendar automatically.",
  },
  {
    title: "Request it, take it anywhere",
    body: "We say what to get and why, and write you a real request. You take it to whichever laboratory or clinic you like, pay them directly, and we take nothing on it.",
  },
  {
    title: "One visit, most of the time",
    body: "Most checks are a single visit: a blood sample, a measurement, or a short procedure. The app tells you exactly how to prepare beforehand.",
  },
  {
    title: "A doctor reads every result",
    body: "Nothing is left to a printout. A doctor reviews every result against your history. An abnormal result triggers an immediate alert and follow-up within a day, or within 12 hours if it's critical; it's never just filed away.",
  },
];

export default function ScreeningJourneyPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Know what to check, and when
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Your Screening Journey
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Recommended screenings change with age and sex, and it&apos;s easy to lose track of
            what you actually need. Tell us your age group and sex, and see the screenings
            recommended for you, walked through step by step: why it matters, how to book it,
            what the day looks like, and how you get your results.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <HowTestingWorks current="periodic" />
      </Section>

      <Section>
        <ScreeningJourney />
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="The pattern behind every screening"
          title="Four steps, every time"
          description="Whichever screening you're looking at above, the mechanics behind it are the same."
        />
        <ol className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {GENERAL_STEPS.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <p className="font-heading text-2xl font-bold text-brand-green">{index + 1}</p>
              <h3 className="mt-2 font-heading text-base font-semibold text-charcoal-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8 text-center">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            Want this built around you automatically?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            This page shows a general journey by age and sex. Sign up and your{" "}
            <Link href={MARKETING_ROUTES.prevention} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              real screening calendar
            </Link>{" "}
            is built from your actual age, sex, and family history, with reminders when something
            comes due, and the whole thing bundled into the one-day{" "}
            <Link href={MARKETING_ROUTES.annualHealthCheck} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              Annual Health Check
            </Link>{" "}
            if you&apos;d rather do it all at once.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <EmergencyNotice />
      </Section>

      <Section className="pb-24">
        <CtaBand
          variant="gradient"
          title="See your screening calendar."
          description="Two minutes to set up, and you'll know exactly what's due and when."
          primaryHref="/signup"
          primaryLabel="Build my calendar"
          secondaryHref={MARKETING_ROUTES.annualHealthCheck}
          secondaryLabel="See the Annual Health Check"
        />
      </Section>
    </>
  );
}
