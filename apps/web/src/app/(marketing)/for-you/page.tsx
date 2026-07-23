import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { DashboardPreview } from "../_components/dashboard-preview";
import { EmergencyNotice } from "../_components/emergency-notice";
import { Section, SectionHeading } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { SERVICE_CARDS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "For you",
  description:
    "What TarragonHealth does for you as an individual: doctor-reviewed monitoring for hypertension, diabetes, and obesity, preventive screening, medication support, and lab coordination on one record.",
  alternates: { canonical: MARKETING_ROUTES.forYou },
};

/** Everything an individual patient uses — ParentCare has its own page. */
const FOR_YOU_CARDS = SERVICE_CARDS.filter((card) => card.key !== "parentcare");

const MONTH_WITH_TARRAGON = [
  {
    title: "You log, in seconds",
    body: "A blood pressure reading after breakfast, a glucose check, your weight once a week — each takes under a minute in the app, and lands on one secure record instead of a paper notebook.",
  },
  {
    title: "Reminders keep you consistent",
    body: "WhatsApp and SMS nudges arrive when a dose, reading, or check is due, so consistency stops depending on memory. You can also message your care team on WhatsApp whenever you have a question.",
  },
  {
    title: "A doctor actually reviews your numbers",
    body: "On paid plans, a doctor reviews your trends every month (weekly on Complete Care) — even when you feel fine. That's the difference between owning a BP monitor and being monitored.",
  },
  {
    title: "Labs and refills are arranged for you",
    body: "When a test is due or medication runs low, Tarragon shows you the exact price, books a vetted partner lab or licensed pharmacy, and follows the result until a doctor has reviewed it.",
  },
  {
    title: "Escalation only when it's needed",
    body: "Steady numbers get calm follow-up. A worrying pattern gets escalated through a defined clinical pathway, quickly and without drama — you are never left wondering whether anyone noticed.",
  },
];

export default function ForYouPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="For you"
          title="Track your health without carrying it alone"
          description="Most people only discover a problem when it becomes an emergency. Tarragon gives you what a well-run clinic gives its best-followed patients — someone watching your numbers between visits — through your phone, at a fraction of the cost of a single hospital admission."
        />
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Start monitoring</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={MARKETING_ROUTES.pricing}>Find your plan</Link>
          </Button>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What it's like"
          title="A month on Tarragon"
          description="No jargon, no hospital queues — here is what actually happens once you join."
        />
        <ol className="mx-auto grid max-w-3xl gap-6">
          {MONTH_WITH_TARRAGON.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-semibold text-white"
                aria-hidden
              >
                {index + 1}
              </span>
              <div>
                <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{step.title}</h3>
                <p className="mt-1 text-charcoal-ink/70">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="What we help you manage"
          title="Programmes built around your health, not one symptom"
          description="Chronic care for hypertension, diabetes, and obesity; preventive screening to stay ahead; medication and lab support to keep everything on track — all on one shared record."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FOR_YOU_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <DashboardPreview />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Start where you are"
          title="Free to start, real care when you want it"
        />
        <div className="mx-auto max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            Tarragon Free lets you track your own numbers forever, at no cost — it never expires and
            never converts to a paid plan on its own. When you want a doctor actually reviewing your
            readings, Essential Care starts at ₦8,000/month for one condition, and Complete Care
            covers hypertension, diabetes, and obesity together with weekly review.
          </p>
          <p>
            Not sure which fits? The three-question plan finder on the{" "}
            <Link href={MARKETING_ROUTES.pricing} className="font-medium text-deep-forest hover:underline">
              pricing page
            </Link>{" "}
            points you to the right one — and looking after a parent instead?{" "}
            <Link href={MARKETING_ROUTES.parentcare} className="font-medium text-deep-forest hover:underline">
              ParentCare
            </Link>{" "}
            is built exactly for that.
          </p>
        </div>
      </Section>

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Care that stays with you."
          description="Start monitoring today — it takes minutes to set up."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
