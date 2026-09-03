import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { MentalWellbeingCheck } from "../_components/mental-wellbeing-check";
import { MentalHealthSupportNotice } from "../_components/mental-health-support-notice";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Mental Well-being Check",
  description:
    "A free, anonymous two-minute check-in on how you're really doing. Not a diagnosis, nothing saved, just a quick, honest pulse-check with a next step if you want one.",
  path: MARKETING_ROUTES.mentalWellbeingCheck,
});

const FAQS = [
  {
    q: "Is this a diagnosis?",
    a: "No. This is a general wellbeing pulse-check, not a clinical or diagnostic tool, and it's not a substitute for talking to a doctor.",
  },
  {
    q: "Is my answer saved anywhere?",
    a: "No. Scoring happens entirely in your browser. Nothing you answer here is sent to Tarragon or saved anywhere, whether or not you have an account.",
  },
  {
    q: "What happens after I get a result?",
    a: "Whatever your result, the choice is yours. If you'd like to talk to someone, a Tarragon doctor is available through the app, and signed-up patients also get access to a more thorough, clinician-reviewed mental health screen as part of their care.",
  },
  {
    q: "What if I'm in crisis right now?",
    a: "Please don't wait for a quiz result. Call one of the support lines below, reach out to someone you trust, or go to the nearest emergency department. Tarragon does not provide emergency or crisis response.",
  },
];

export default function MentalWellbeingCheckPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Two minutes, ten questions
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            How are you really doing?
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Mental well-being is as real as your blood pressure, and just as worth checking on.
            This is a free, anonymous pulse-check, not a diagnosis, just an honest starting
            point.
          </p>
        </div>
      </Section>

      <Section>
        <MentalWellbeingCheck />
      </Section>

      <Section variant="sage">
        <MentalHealthSupportNotice />
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
            Beyond the quiz
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            A pulse-check is a starting point, not the full picture. Once you&apos;re signed up,
            Tarragon&apos;s{" "}
            <Link href={MARKETING_ROUTES.healthEducation} className="text-brand-green hover:underline">
              Health Education
            </Link>{" "}
            surfaces guidance built around you, and your care team can arrange a fuller,
            clinician-reviewed screen as part of your ongoing care, the same way physical checks
            are.
          </p>
        </div>
      </Section>

      <Section className="pb-24">
        <CtaBand
          variant="gradient"
          title="You don't have to figure it out alone."
          description="A doctor on Tarragon is a message away, whenever you're ready."
          primaryHref="/signup"
          primaryLabel="Talk to a doctor"
          secondaryHref={MARKETING_ROUTES.healthEducation}
          secondaryLabel="Explore Health Education"
        />
      </Section>
    </>
  );
}
