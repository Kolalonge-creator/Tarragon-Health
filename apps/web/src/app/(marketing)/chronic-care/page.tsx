import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { StepsExplorer } from "../_components/steps-explorer";
import { SERVICE_CARDS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { ResourceCarousel } from "../_components/resource-carousel";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "Chronic care",
  description:
    "Ongoing monitoring for chronic conditions like hypertension, diabetes, and weight management: readings, medication, labs, and doctor review on one record, with escalation when closer care is needed.",
  path: MARKETING_ROUTES.chronicCare,
});

const CHRONIC_KEYS = ["hypertension", "diabetes", "obesity"] as const;
const CHRONIC_CARDS = SERVICE_CARDS.filter((card) =>
  (CHRONIC_KEYS as readonly string[]).includes(card.key)
);

const HOW = [
  {
    title: "Consistent monitoring",
    body: "Log blood pressure, blood sugar, weight, and medication through the app or web, or let a connected BP cuff, glucometer, or wearable fill in the reading as we bring each device online. Either way, it lands on one longitudinal record.",
  },
  {
    title: "Reviewed between visits",
    body: "Your care team reviews your trends against care protocols and follows up when something needs attention.",
  },
  {
    title: "Escalation when needed",
    body: "A reading that needs closer care is escalated through a defined pathway, so nothing is missed between visits.",
  },
];

export default async function ChronicCarePage() {
  const articles = await loadResourceArticles();
  const cholesterolArticles = articles.filter((a) => a.category === "Cholesterol");

  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Chronic care"
          title="Steady, followed-up care for long-term conditions"
          description="Chronic disease isn't managed in the clinic, it's managed in the days between visits. Tarragon keeps watch on your readings, medication, and labs, and acts when something changes."
        />
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CHRONIC_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="How chronic care works" title="Monitor, review, escalate" />
        <StepsExplorer steps={HOW} tone="navy" />
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Looking after a parent with a long-term condition?{" "}
          <Link href={MARKETING_ROUTES.parentcare} className="font-medium text-deep-forest hover:underline">
            Caring for a parent
          </Link>{" "}
          brings the same monitoring together for a loved one, with opt-in family updates.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Cholesterol and overall cardiovascular risk are watched alongside these conditions on the
          same record, not as a separate programme: your doctor factors your cholesterol readings
          into the same review that watches your blood pressure and blood sugar, because they
          drive the same underlying risk.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Managing a chronic condition can weigh on you too. Try our free, two-minute{" "}
          <Link href={MARKETING_ROUTES.mentalWellbeingCheck} className="font-medium text-deep-forest hover:underline">
            mental well-being check
          </Link>
          , no sign-up required.
        </p>
      </Section>

      {cholesterolArticles.length > 0 ? (
        <Section>
          <ResourceCarousel
            title="Explore more Cholesterol & Heart Health resources"
            articles={cholesterolArticles}
          />
        </Section>
      ) : null}

      <Section className="pb-24">
        <CtaBand
          title="Manage a chronic condition with support"
          description="Start monitoring today, with clinical review and escalation built in."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
