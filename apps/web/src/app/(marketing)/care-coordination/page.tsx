import type { Metadata } from "next";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { SERVICE_CARDS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Care coordination",
  description:
    "TarragonHealth coordinates labs, medication, and specialist referrals so the pieces of your care stay connected instead of scattered.",
  alternates: { canonical: MARKETING_ROUTES.careCoordination },
};

const COORDINATION_KEYS = ["medication", "labs"] as const;
const COORDINATION_CARDS = SERVICE_CARDS.filter((card) =>
  (COORDINATION_KEYS as readonly string[]).includes(card.key)
);

const CONNECTS = [
  {
    title: "Labs",
    body: "Know what tests are due, book them through partner labs, and track results and follow-up on the same record.",
  },
  {
    title: "Medication",
    body: "Refill reminders and pharmacy coordination so you avoid running out or missing doses.",
  },
  {
    title: "Specialist referrals",
    body: "When your care team refers you on, the handoff carries your record with it, not a lost paper slip.",
  },
];

export default function CareCoordinationPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Care coordination"
          title="The pieces of your care, kept connected"
          description="Labs, pharmacies, and specialists are often scattered across different places. Tarragon is the coordination layer that keeps them working from one shared record."
        />
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
          {COORDINATION_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="What we connect" title="One record, less chasing" />
        <div className="grid gap-6 md:grid-cols-3">
          {CONNECTS.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-green/30 hover:shadow-md"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-soft-sage text-deep-forest"
                aria-hidden
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <h3 className="mt-4 font-heading text-xl font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-3 text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section className="pb-24">
        <CtaBand
          title="Keep your care coordinated"
          description="Labs, medication, and referrals working from one record."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
