import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { BmiCalorieCalculator } from "../_components/bmi-calorie-calculator";
import { CtaBand } from "../_components/cta-band";
import { EmergencyNotice } from "../_components/emergency-notice";
import { ResourceCarousel } from "../_components/resource-carousel";
import { loadResourceArticles } from "@/lib/marketing/resources-data";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "BMI & Calorie Calculator",
  description:
    "Free BMI calculator and daily calorie estimate. See your body mass index range and an estimated calorie target for maintaining, losing, or gaining weight, no sign-up required.",
  alternates: { canonical: MARKETING_ROUTES.bmiCalculator },
};

const FAQS = [
  {
    q: "How is BMI calculated?",
    a: "Body Mass Index is your weight in kilograms divided by your height in metres, squared (kg/m²). It's a quick screening tool, not a full body-composition measurement, so it's read alongside things like waist size and how you actually feel, not on its own.",
  },
  {
    q: "How is the calorie estimate worked out?",
    a: "We use the Mifflin-St Jeor equation, a widely used formula for estimating how many calories your body burns at rest, then adjust it for your activity level. It's a solid starting estimate, but everybody's metabolism differs a little.",
  },
  {
    q: "Is BMI accurate for everyone?",
    a: "No single number is. BMI doesn't distinguish muscle from fat, and can read differently for very muscular people, pregnant women, older adults, or children. It's a useful first check, not a diagnosis.",
  },
  {
    q: "What should I do with a high or low result?",
    a: "Use it as a starting point for a conversation, not a verdict. A doctor on Tarragon can look at your BMI alongside your waist measurement, your history, and how you're actually doing, and build a real plan around it if one is needed.",
  },
];

export default async function BmiCalculatorPage() {
  const articles = await loadResourceArticles();
  const weightArticles = articles.filter((a) => a.category === "Weight");

  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Free tool"
          title="BMI & Calorie Calculator"
          description="A quick, honest starting point: your body mass index range and an estimated daily calorie target. No account, no email required."
        />
        <BmiCalorieCalculator />
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Good to know"
          title="Common questions"
        />
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
          eyebrow="Beyond the number"
          title="What comes after a BMI check"
          description="A calculator gives you a range. A doctor turns that into a real picture: your waist measurement, your history, and whether anything actually needs to change."
        />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Weight in the healthy range
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Our{" "}
              <Link href={MARKETING_ROUTES.prevention} className="font-medium text-deep-forest hover:underline">
                Prevention programme
              </Link>{" "}
              builds a screening and vaccination calendar around you, so small things get caught
              early, whether or not your weight is a factor.
            </p>
          </div>
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Overweight or higher range
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Our{" "}
              <Link href={MARKETING_ROUTES.obesity} className="font-medium text-deep-forest hover:underline">
                Weight Health programme
              </Link>{" "}
              is doctor-led, lifestyle-first support, not judgment: real medication and lifestyle
              guidance if it&apos;s needed, built around you.
            </p>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-charcoal-ink/70">
          Curious how active you are day to day too? Try the{" "}
          <Link href={MARKETING_ROUTES.activityCalculator} className="font-medium text-deep-forest hover:underline">
            physical activity intensity calculator
          </Link>
          .
        </p>
      </Section>

      {weightArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel title="Explore more Weight Management resources" articles={weightArticles} />
        </Section>
      ) : null}

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Care that stays with you."
          description="Start monitoring today; it takes minutes to set up."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
