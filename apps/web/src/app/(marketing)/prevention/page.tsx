import { notFound } from "next/navigation";
import Link from "next/link";
import { ProductPageTemplate } from "../_components/product-page-template";
import { Section, SectionHeading } from "../_components/section";
import { getProductPage } from "../_content/products";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { ResourceCarousel } from "../_components/resource-carousel";
import { PlanPreviewSample } from "../_components/plan-preview-sample";
import { StepsExplorer } from "../_components/steps-explorer";
import { StaggeredReveal } from "../_components/staggered-reveal";
import { PILLARS, PILLARS_SECTION_COPY } from "../_content/pillars";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

export const revalidate = 300;

export function generateMetadata() {
  const content = getProductPage("prevention");
  return content?.metadata ?? {};
}

/**
 * The screening categories mirror what the platform actually tracks
 * (FEATURE_SPEC Cat 2: cancer / metabolic / infectious / reproductive).
 * Examples only; the personal calendar is built from age, sex, and history.
 */
const SCREENING_GROUPS = [
  {
    title: "Heart and metabolic checks",
    intro: "These checks measure the factors behind hypertension, diabetes and heart disease, the conditions that cause most preventable emergencies.",
    tests: [
      "Blood pressure, weight and body mass index (BMI)",
      "Fasting blood sugar and HbA1c (3-month sugar average)",
      "Lipid panel (cholesterol)",
      "Kidney function (U&E + eGFR) and urinalysis",
    ],
  },
  {
    title: "Cancer screening",
    intro: "These are matched to your age and sex, because cancer found early is much more treatable.",
    tests: [
      "Cervical smear for women (from age 25)",
      "Breast screening for women (from age 40)",
      "PSA prostate screening for men (from age 45)",
      "Colorectal screening (from age 45)",
    ],
  },
  {
    title: "Infectious disease checks",
    intro: "Some infections cause no symptoms for years and do the most damage when nobody is looking for them.",
    tests: [
      "HIV screening",
      "Hepatitis B screening",
      "Hepatitis C screening",
    ],
  },
  {
    title: "Vaccinations & reproductive health",
    intro: "Tarragon tracks which vaccinations are due, reminds you, and points you to those that are already free before you pay anyone. You can add your children too, even before they are old enough to have their own login.",
    tests: [
      "A full childhood immunisation record for each of your children, following the same recognised schedule as their paper card, but one that cannot be lost",
      "HPV vaccination (free at government PHC centres for girls 9–14; catch-up doses bookable for women 15–45)",
      "Hepatitis B vaccination series, with each dose tracked to completion",
      "Optional cycle tracking for women, with gentle reminders: an estimated date for your next period (an estimate, not a prediction), a reminder to book antenatal care once you are pregnant, or a prompt to talk to your care team as perimenopause or menopause begins",
    ],
  },
  {
    title: "Know your blood group and genotype",
    intro: "If you do not yet know your blood group and genotype, you can arrange the test directly. The results are useful for marriage counselling, pregnancy planning and emergencies.",
    tests: ["Blood group & rhesus factor", "Sickle cell genotype (AA/AS/SS)"],
  },
];

const ABNORMAL_STEPS = [
  {
    title: "A doctor is alerted immediately",
    body: "An abnormal result does not wait in a queue. It triggers an immediate alert to a doctor, who reviews it against your history as a priority rather than in a later batch.",
  },
  {
    title: "You hear from your care team fast",
    body: "Your care team contacts you within hours rather than weeks, and explains what the result means in plain language.",
  },
  {
    title: "Follow-up until the matter is resolved",
    body: "If the result needs ongoing attention, your record moves into long-term care monitoring on the same platform, with the same record and the same care team, so you do not start again, and there is no extra charge for the follow-up.",
  },
];

export default async function PreventionPage() {
  const content = getProductPage("prevention");
  if (!content) notFound();

  const articles = await loadResourceArticles();
  const preventionArticles = articles.filter(
    (a) => a.category === "Screening" || a.category === "Nutrition"
  );

  return (
    <ProductPageTemplate content={content}>
      <Section>
        <SectionHeading
          eyebrow="Try it yourself"
          title="What could your screening plan look like?"
          description="Your actual calendar is built from your health profile after you sign up. This is a short, illustrative preview of the same idea."
        />
        <PlanPreviewSample />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="What we screen for"
          title="The checks your calendar is built from"
          description="Your personal screening calendar is built from your age, sex, family history and risk profile, so you see only what is relevant to you. Each check is tracked, you are reminded when it is due, and a result that needs attention is flagged."
        />
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2">
          {SCREENING_GROUPS.map((group, index) => (
            <div
              key={group.title}
              // Span a lone trailing card so an odd count never leaves an
              // orphan in the left column.
              className={
                index === SCREENING_GROUPS.length - 1 && SCREENING_GROUPS.length % 2 === 1
                  ? "rounded-xl border border-charcoal-ink/10 bg-white p-6 sm:col-span-2"
                  : "rounded-xl border border-charcoal-ink/10 bg-white p-6"
              }
            >
              <h3 className="font-heading text-xl font-semibold text-charcoal-ink">{group.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/65">{group.intro}</p>
              <ul className="mt-4 space-y-2">
                {group.tests.map((test) => (
                  <li key={test} className="flex gap-2 text-sm text-charcoal-ink/80">
                    <span aria-hidden className="mt-0.5 shrink-0 text-brand-green">✓</span>
                    {test}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          You take your request to whichever laboratory you like and pay them directly: we set no
          price on any test and take no commission. The one-day{" "}
          <span className="font-medium text-charcoal-ink">Annual Health Check</span> has several levels.
          You choose how thorough you want it to be, and a doctor reviews every level.
        </p>
        <p className="mx-auto mt-4 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          If you are not sure which screenings apply to you, follow the{" "}
          <Link href={MARKETING_ROUTES.screeningJourney} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            Screening Journey
          </Link>
          . Enter your age and sex and see each recommended screening, step by step, from booking
          to results.
        </p>
        <p className="mx-auto mt-4 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          If you also look after your children&apos;s vaccinations, see how the{" "}
          <Link href={MARKETING_ROUTES.vaccinations} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            schedule, reminders, and doctor-verified certificates
          </Link>{" "}
          work for you and your children.
        </p>
        <p className="mx-auto mt-4 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          If you would like to know where you stand before booking anything, try the free{" "}
          <Link href={MARKETING_ROUTES.bmiCalculator} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            BMI and calorie calculator
          </Link>{" "}
          or the{" "}
          <Link href={MARKETING_ROUTES.activityCalculator} className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
            activity intensity calculator
          </Link>
          . No sign-up is required.
        </p>
      </Section>

      <Section>
        <SectionHeading
          eyebrow={PILLARS_SECTION_COPY.eyebrow}
          title={PILLARS_SECTION_COPY.title}
          description={PILLARS_SECTION_COPY.description}
        />
        <StaggeredReveal className="grid gap-px overflow-hidden rounded-2xl bg-charcoal-ink/10 sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((pillar) => (
            <div
              key={pillar.module}
              className="relative h-full bg-white p-6 transition-transform duration-300 hover:z-10 hover:-translate-y-1 hover:shadow-lg"
            >
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">{pillar.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{pillar.body}</p>
            </div>
          ))}
        </StaggeredReveal>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="When something is flagged"
          title="What happens if a result comes back abnormal"
          description="This is the moment that prevention exists for, and the one that many health systems miss. At Tarragon it is the highest-priority event on the platform."
        />
        <div className="mx-auto max-w-4xl">
          <StepsExplorer steps={ABNORMAL_STEPS} tone="navy" />
        </div>
      </Section>

      {preventionArticles.length > 0 ? (
        <Section>
          <ResourceCarousel
            title="More resources on prevention and nutrition"
            articles={preventionArticles}
          />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
