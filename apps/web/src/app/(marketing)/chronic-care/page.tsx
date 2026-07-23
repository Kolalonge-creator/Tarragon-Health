import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { SERVICE_CARDS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Chronic care",
  description:
    "Ongoing monitoring for chronic conditions like hypertension, diabetes, and obesity: readings, medication, labs, and doctor review on one record, with escalation when closer care is needed.",
  alternates: { canonical: MARKETING_ROUTES.chronicCare },
};

const CHRONIC_KEYS = ["hypertension", "diabetes", "obesity"] as const;
const CHRONIC_CARDS = SERVICE_CARDS.filter((card) =>
  (CHRONIC_KEYS as readonly string[]).includes(card.key)
);

const HOW = [
  {
    title: "Consistent monitoring",
    body: "Log blood pressure, blood sugar, weight, and medication through the app or web, all on one longitudinal record.",
  },
  {
    title: "Doctor review",
    body: "Your care team reviews your trends against care protocols and follows up when something needs attention.",
  },
  {
    title: "Escalation when needed",
    body: "A reading that needs closer care is escalated through a defined pathway, so nothing is missed between visits.",
  },
];

export default function ChronicCarePage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
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
        <ol className="grid gap-6 md:grid-cols-3">
          {HOW.map((item, index) => (
            <li
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-green/30 hover:shadow-md"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-clinical-navy font-heading text-sm font-semibold text-white"
                aria-hidden
              >
                {index + 1}
              </span>
              <h3 className="mt-4 font-heading text-xl font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-3 text-charcoal-ink/70">{item.body}</p>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Looking after a parent with a long-term condition?{" "}
          <Link href={MARKETING_ROUTES.parentcare} className="font-medium text-deep-forest hover:underline">
            ParentCare
          </Link>{" "}
          brings the same monitoring together for a loved one, with opt-in family updates.
        </p>
      </Section>

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
