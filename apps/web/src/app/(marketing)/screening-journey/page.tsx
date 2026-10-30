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
    title: "Find out what is recommended",
    body: "Choose your age group and sex below, or sign up and let your own profile (age, sex and family history) create your personal screening calendar automatically.",
  },
  {
    title: "Take your request to any provider",
    body: "We tell you which screening to have and why, and we write a request that you can take to any laboratory or clinic. You pay the provider directly, and we take no commission.",
  },
  {
    title: "Usually a single visit",
    body: "Most checks need only one visit: a blood sample, a measurement or a short procedure. The app explains how to prepare beforehand.",
  },
  {
    title: "A doctor reads every result",
    body: "A doctor reviews every result against your history instead of reading a printout on its own. An abnormal result triggers an immediate alert and follow-up within a day, or within 12 hours if it is critical.",
  },
];

export default function ScreeningJourneyPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Know what to check and when
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Your Screening Journey
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Screening needs change with age and sex, and it is easy to lose track. Tell us
            your age group and sex, and we will explain which screenings are recommended: why
            each one matters, how to arrange it, and how your results are returned to you.
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
          title="The same four steps every time"
          description="Whichever screening you are looking at above, the process behind it is the same."
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
            Would you like this built around you automatically?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            This page shows a general journey by age and sex. If you sign up, your{" "}
            <Link href={MARKETING_ROUTES.prevention} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              real screening calendar
            </Link>{" "}
            is built from your actual age, sex and family history, with reminders when a screening
            is due. You can also combine them in the one-day{" "}
            <Link href={MARKETING_ROUTES.annualHealthCheck} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              Annual Health Check
            </Link>{" "}
            if you would rather do everything at once.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <EmergencyNotice />
      </Section>

      <Section className="pb-24">
        <CtaBand
          variant="gradient"
          title="See your screening calendar"
          description="Setting up takes two minutes, and then you will know which screenings are due and when."
          primaryHref="/signup"
          primaryLabel="Build my calendar"
          secondaryHref={MARKETING_ROUTES.annualHealthCheck}
          secondaryLabel="See the Annual Health Check"
        />
      </Section>
    </>
  );
}
