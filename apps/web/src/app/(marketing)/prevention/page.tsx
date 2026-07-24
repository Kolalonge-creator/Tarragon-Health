import { notFound } from "next/navigation";
import Link from "next/link";
import { ProductPageTemplate } from "../_components/product-page-template";
import { Section, SectionHeading } from "../_components/section";
import { getProductPage } from "../_content/products";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

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
    title: "Heart & metabolic checks",
    intro: "The numbers behind hypertension, diabetes, and heart disease: the conditions that cause most preventable emergencies.",
    tests: [
      "Blood pressure, weight, and BMI",
      "Fasting blood sugar and HbA1c (3-month sugar average)",
      "Lipid panel (cholesterol)",
      "Kidney function (U&E + eGFR) and urinalysis",
    ],
  },
  {
    title: "Cancer screening",
    intro: "Matched to your age and sex, because catching cancer early changes everything about how treatable it is.",
    tests: [
      "Cervical smear for women (from age 25)",
      "Breast screening for women (from age 40)",
      "PSA prostate screening for men (from age 45)",
      "Colorectal screening (from age 45)",
    ],
  },
  {
    title: "Infectious disease checks",
    intro: "Quiet infections that do the most damage when nobody is looking for them.",
    tests: [
      "HIV screening",
      "Hepatitis B screening",
      "Hepatitis C screening",
    ],
  },
  {
    title: "Vaccinations & reproductive health",
    intro: "Tarragon tracks what's due, reminds you, and points you to what's already free before you pay anyone. Add your children too, even before they're old enough to have their own login.",
    tests: [
      "A full childhood immunisation record for each of your children, on the same recognised schedule as their paper card, but one you can't lose",
      "HPV vaccination (free at government PHC centres for girls 9–14; catch-up doses bookable for women 15–45)",
      "Hepatitis B vaccination series, with each dose tracked to completion",
      "Optional cycle tracking for women, with gentle nudges — an estimated next period (never a prediction), a nudge to book antenatal care once you're pregnant, or a nudge to talk to your care team as perimenopause or menopause begins",
    ],
  },
  {
    title: "Know your basics",
    intro: "Don't know your blood group and genotype yet? Book it directly: useful for marriage counselling, pregnancy planning, and emergencies.",
    tests: ["Blood group & rhesus factor", "Sickle cell genotype (AA/AS/SS)"],
  },
];

const ABNORMAL_STEPS = [
  {
    title: "A doctor is alerted immediately",
    body: "An abnormal result is never just filed away. It triggers an immediate alert to a doctor, who reviews it against your history, not in next month's batch, but as a priority.",
  },
  {
    title: "You hear from your care team fast",
    body: "Your care team contacts you within hours, not weeks, and explains what the result means in plain language, calmly, without fear tactics.",
  },
  {
    title: "Follow-up until the loop is closed",
    body: "If the result needs ongoing attention, your record upgrades into chronic care monitoring on the same platform: same record, same care team, no starting over. There is never an automatic extra charge for follow-up on a result.",
  },
];

export default function PreventionPage() {
  const content = getProductPage("prevention");
  if (!content) notFound();
  return (
    <ProductPageTemplate content={content}>
      <Section>
        <SectionHeading
          eyebrow="What we screen for"
          title="The checks your calendar is built from"
          description="Your personal screening calendar is built from your age, sex, family history, and risk profile, so you only see what's relevant to you. These are the kinds of checks it tracks, reminds you about, and flags when results need attention."
        />
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2">
          {SCREENING_GROUPS.map((group) => (
            <div
              key={group.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6"
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
          Every test is booked through a vetted partner lab, and you always see the exact price and
          confirm before anything is booked; typical prices are listed openly on the{" "}
          <Link href={MARKETING_ROUTES.pricing} className="font-medium text-deep-forest hover:underline">
            pricing page
          </Link>
          . The one-day{" "}
          <span className="font-medium text-charcoal-ink">Annual Health Check</span> bundles the
          core checks with a doctor consultation about your results.
        </p>
        <p className="mx-auto mt-4 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/70">
          Looking after your children&apos;s vaccinations too? See how the{" "}
          <Link href={MARKETING_ROUTES.vaccinations} className="font-medium text-deep-forest hover:underline">
            schedule, reminders, and doctor-verified certificates
          </Link>{" "}
          work for your whole family.
        </p>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="When something is flagged"
          title="What happens if a result comes back abnormal"
          description="This is the moment prevention exists for, and the moment most health systems drop. At Tarragon it is the highest-priority event on the platform."
        />
        <ol className="mx-auto grid max-w-4xl gap-6 md:grid-cols-3">
          {ABNORMAL_STEPS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-clinical-navy font-heading text-sm font-semibold text-white"
                aria-hidden
              >
                {index + 1}
              </span>
              <h3 className="mt-4 font-heading text-lg font-semibold text-charcoal-ink">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>
    </ProductPageTemplate>
  );
}
