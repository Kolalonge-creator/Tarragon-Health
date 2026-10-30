import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { SymptomToTestCheck } from "../_components/symptom-to-test-check";
import { EmergencyNotice } from "../_components/emergency-notice";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Symptom Checker",
  description:
    "A free, anonymous starting point: tell us what you're noticing, and get a suggested test or a doctor conversation. Not a diagnosis, nothing saved.",
  path: MARKETING_ROUTES.symptomChecker,
});

const FAQS = [
  {
    q: "Is this a diagnosis?",
    a: "No. This tool compares your symptoms with a short, doctor-reviewed list of common patterns and suggests a next step. It provides information and helps you decide what to do next. It is not a diagnosis, and it does not replace an assessment by a doctor.",
  },
  {
    q: "Is my answer saved anywhere?",
    a: "No. Matching happens entirely in your browser. Nothing you answer here is sent to Tarragon or saved anywhere, whether or not you have an account.",
  },
  {
    q: "Why does it only recognise a few patterns?",
    a: "We would rather advise you to talk to a doctor than guess. Only a short, pre-approved list of low-risk symptom patterns produces a specific test suggestion here. Everything else, including anything that sounds urgent, directs you to a doctor instead.",
  },
  {
    q: "What happens after I get a suggestion?",
    a: "You can choose either option: sign up and request the suggested test yourself, or book a doctor's consultation first for a proper assessment before any test is ordered. Both options are always offered together.",
  },
];

export default function SymptomCheckerPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Takes two minutes, no account needed
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            What are you noticing?
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            A symptom that worries you should not be left without a next step. Tell us what
            you have been feeling, and if it matches a common pattern that we recognise, we will
            suggest a specific test. You can instead choose to speak to a doctor first, who can
            assess you before any testing.
          </p>
        </div>
      </Section>

      <Section>
        <SymptomToTestCheck />
      </Section>

      <Section variant="sage">
        <EmergencyNotice />
      </Section>

      <Section>
        <SectionHeading eyebrow="Good to know" title="Common questions" />
        <div className="mx-auto grid max-w-3xl gap-6">
          {FAQS.map((item) => (
            <div key={item.q} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.a}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8 text-center">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            Already have a care team?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Once you have signed up, the same check is available in your dashboard, and your{" "}
            <Link href="/patient/care" className="text-brand-green hover:underline">
              AI Coach
            </Link>{" "}
            can give the same suggestion during a conversation, using your health record
            as well.
          </p>
        </div>
      </Section>

      <Section className="pb-24">
        <CtaBand
          variant="gradient"
          title="Get a clear next step instead of guessing"
          description="Sign up to request the test or book the consultation."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.prevention}
          secondaryLabel="See ongoing prevention"
        />
      </Section>
    </>
  );
}
