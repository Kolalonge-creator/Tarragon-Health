import type { Metadata } from "next";
import { CtaBand } from "../_components/cta-band";
import { DashboardPreview } from "../_components/dashboard-preview";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { Section, SectionHeading } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { HOW_IT_WORKS_STEPS, SERVICE_CARDS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Services",
  description:
    "Everything TarragonHealth helps you manage: chronic disease, preventive health, medication, labs, and care coordination, in one connected record.",
  alternates: { canonical: MARKETING_ROUTES.services },
};

export default function ServicesPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Services"
          title="What we help you manage"
          description="Chronic disease, preventive health, medication, and labs, all on one shared record so nothing falls through the cracks between visits."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              How it works
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              From sign-up to ongoing care
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Readings, reminders, doctor review, and coordinated follow-up stay
              connected on one record, so the next step is always clear.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "connected-care",
              imageAlt: "Readings, reminders, and doctor review in one connected record",
            }}
          />
        </div>

        <ol className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HOW_IT_WORKS_STEPS.map(({ step, title, body }) => (
            <li
              key={step}
              className="flex gap-3 rounded-xl border border-charcoal-ink/10 bg-white p-4"
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clinical-navy text-xs font-semibold text-white"
                aria-hidden
              >
                {step}
              </span>
              <div>
                <h3 className="font-heading text-sm font-semibold text-charcoal-ink">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-charcoal-ink/70">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <DashboardPreview />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="One calm view for the care between visits"
          description="Start monitoring today, for yourself or someone you love."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
