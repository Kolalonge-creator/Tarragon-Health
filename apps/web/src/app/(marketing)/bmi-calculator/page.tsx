import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { BmiCalorieCalculator } from "../_components/bmi-calorie-calculator";
import { CtaBand } from "../_components/cta-band";
import { EmergencyNotice } from "../_components/emergency-notice";
import { ResourceCarousel } from "../_components/resource-carousel";
import { loadResourceArticles } from "@/lib/marketing/resources-data";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "BMI & Calorie Calculator",
  description:
    "Free BMI calculator and daily calorie estimate. See your body mass index range and a calorie target for maintaining, losing or gaining weight, no sign-up.",
  path: MARKETING_ROUTES.bmiCalculator,
});

const FAQS = [
  {
    q: "How is BMI calculated?",
    a: "Body mass index is your weight in kilograms divided by your height in metres, squared (kg/m²). It is a quick screening tool and not a full measure of body composition, so it should be read alongside your waist size and how you feel, and not on its own.",
  },
  {
    q: "How is the calorie estimate worked out?",
    a: "We use the Mifflin-St Jeor equation, a widely used formula for estimating how many calories your body burns at rest, and then adjust it for your activity level. It is a reliable starting estimate, but everyone's metabolism differs slightly.",
  },
  {
    q: "Is BMI accurate for everyone?",
    a: "No single number is. BMI does not distinguish muscle from fat, and it can be misleading for very muscular people, pregnant women, older adults and children. It is a useful first check, not a diagnosis.",
  },
  {
    q: "What should I do with a high or low result?",
    a: "Use it as a starting point for a conversation, not as a verdict. A doctor on Tarragon can consider your BMI together with your waist measurement, your history and how you are feeling, and can build a plan around it if one is needed.",
  },
];

export default async function BmiCalculatorPage() {
  const articles = await loadResourceArticles();
  const weightArticles = articles.filter((a) => a.category === "Weight");

  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Free tool"
          title="BMI & Calorie Calculator"
          description="A quick starting point: your body mass index range and an estimated daily calorie target. No account or email address is required."
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
          description="A calculator gives you a range. A doctor builds a fuller picture from it, using your waist measurement and your history, and advises whether anything needs to change."
        />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Weight in the healthy range
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Our{" "}
              <Link href={MARKETING_ROUTES.prevention} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
                Prevention programme
              </Link>{" "}
              creates a screening and vaccination calendar for you, so that small problems are found
              early, whether or not your weight is a factor.
            </p>
          </div>
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
              Overweight or higher range
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Our{" "}
              <Link href={MARKETING_ROUTES.obesity} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
                Weight Health programme
              </Link>{" "}
              offers support that begins with lifestyle changes and without judgement. A doctor reviews
              your progress and adjusts medication or guidance as needed.
            </p>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-charcoal-ink/70">
          If you would also like to know how active you are day to day, try the{" "}
          <Link href={MARKETING_ROUTES.activityCalculator} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            physical activity intensity calculator
          </Link>
          .
        </p>
      </Section>

      {weightArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel title="More resources on weight management" articles={weightArticles} />
        </Section>
      ) : null}

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
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
