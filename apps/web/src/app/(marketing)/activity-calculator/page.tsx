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
    "Free physical activity intensity calculator. Estimate calories burned and see how your session counts toward WHO's weekly activity guideline, no sign-up required.",
  path: MARKETING_ROUTES.activityCalculator,
});

const FAQS = [
  {
    q: "What counts as \"moderate\" or \"vigorous\" activity?",
    a: "It's based on MET (Metabolic Equivalent of Task) values: how many times more energy an activity takes compared to sitting still. Light activity is under 3 METs, moderate is 3-6 METs (you can talk but not sing), and vigorous is above 6 METs (hard to hold a conversation).",
  },
  {
    q: "Why does vigorous activity count double toward the weekly target?",
    a: "The World Health Organization's guideline is 150-300 minutes of moderate activity a week, or 75-150 minutes of vigorous activity, because vigorous activity produces roughly the same benefit in about half the time. This tool reflects that by counting vigorous minutes twice toward the same target.",
  },
  {
    q: "Is this exact?",
    a: "No, it's a general estimate from average energy-expenditure tables. Your actual calorie burn depends on fitness level, terrain, technique, and effort, so treat the number as a useful guide, not a precise measurement.",
  },
  {
    q: "I have a health condition. Is this still useful for me?",
    a: "The estimate itself is fine to use, but if you're starting a new routine and live with a heart condition, high blood pressure, diabetes, or another chronic condition, it's worth checking with a doctor first about what's safe for you specifically.",
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
          description="Estimate the calories burned and intensity of what you just did, and see how it stacks up against WHO's weekly activity guideline. No account, no email required."
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
          title="Building activity into real, ongoing care"
          description="One calculation is a snapshot. Real support looks like a plan built around you, and someone actually checking in."
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
              pairs doctor-reviewed guidance with lifestyle coaching, so activity is part of a real
              plan, not a guess.
            </p>
          </div>
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Living with a chronic condition
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Our{" "}
              <Link href={MARKETING_ROUTES.chronicCare} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
                Chronic Care programmes
              </Link>{" "}
              for hypertension and diabetes factor activity into your care plan alongside
              medication and monitoring.
            </p>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-charcoal-ink/70">
          Want to check your weight range too? Try the{" "}
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
          description="Get started today; it takes minutes to set up."
          primaryHref="/signup"
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
