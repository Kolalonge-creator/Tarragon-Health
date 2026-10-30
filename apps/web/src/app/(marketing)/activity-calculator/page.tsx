import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { ActivityIntensityCalculator } from "../_components/activity-intensity-calculator";
import { CtaBand } from "../_components/cta-band";
import { EmergencyNotice } from "../_components/emergency-notice";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Physical Activity Intensity Calculator",
  description:
    "Free physical activity intensity calculator. Estimate calories burned and see how a session counts towards WHO's weekly activity guideline. No sign-up.",
  path: MARKETING_ROUTES.activityCalculator,
});

const FAQS = [
  {
    q: "What counts as \"moderate\" or \"vigorous\" activity?",
    a: "It is based on MET (metabolic equivalent of task) values, which show how many times more energy an activity uses than sitting still. Light activity is under 3 METs, moderate activity is 3 to 6 METs (you can talk but not sing), and vigorous activity is above 6 METs (it is hard to hold a conversation).",
  },
  {
    q: "Why does vigorous activity count double towards the weekly target?",
    a: "The World Health Organization's guideline is 150-300 minutes of moderate activity a week, or 75-150 minutes of vigorous, because vigorous produces roughly the same benefit in half the time. This tool counts vigorous minutes twice towards that target.",
  },
  {
    q: "Is this exact?",
    a: "No. It is a general estimate from average energy-expenditure tables. The calories you actually burn depend on your fitness level, the terrain, your technique and your effort, so treat the number as a useful guide and not a precise measurement.",
  },
  {
    q: "I have a health condition. Is this still useful for me?",
    a: "You can use the estimate, but if you are starting a new routine and have a heart condition, high blood pressure, diabetes or another long-term condition, check with a doctor first about what is safe for you.",
  },
];

export default function ActivityCalculatorPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Free tool"
          title="Physical Activity Intensity Calculator"
          description="Estimate the calories burned and the intensity of an activity you have done, and see how it compares with the World Health Organization's weekly activity guideline. No account or email address is required."
        />
        <ActivityIntensityCalculator />
      </Section>

      <Section variant="sage">
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

      <Section>
        <SectionHeading
          eyebrow="Beyond one session"
          title="Building activity into ongoing care"
          description="One calculation is a snapshot. Lasting support is a plan built around you, with someone who checks on your progress."
        />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Managing your weight
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Our{" "}
              <Link href={MARKETING_ROUTES.obesity} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
                Weight Health programme
              </Link>{" "}
              combines doctor-reviewed guidance with lifestyle coaching, so that activity is part of a
              clear plan and not a guess.
            </p>
          </div>
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Living with a long-term condition
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Our{" "}
              <Link href={MARKETING_ROUTES.chronicCare} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
                Chronic Care programmes
              </Link>{" "}
              for hypertension and diabetes include activity in your care plan alongside
              medication and monitoring.
            </p>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-charcoal-ink/70">
          If you would also like to check your weight range, try the{" "}
          <Link href={MARKETING_ROUTES.bmiCalculator} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            BMI & calorie calculator
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage">
        <EmergencyNotice />
      </Section>

      <Section className="pb-24">
        <CtaBand
          variant="gradient"
          title="Care that stays with you."
          description="Get started today. Setting up takes only a few minutes."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
