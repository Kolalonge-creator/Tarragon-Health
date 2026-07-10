import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContinuityPath } from "./_components/continuity-path";
import { CtaBand } from "./_components/cta-band";
import { Section, SectionHeading } from "./_components/section";
import { ServiceCardLink } from "./_components/service-card";
import { AUDIENCE_BLOCKS, HOW_IT_WORKS_STEPS, SERVICE_CARDS } from "./_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "TarragonHealth — Care that stays with you",
  description:
    "Clinician-led health monitoring for you, your parents, and your loved ones. Track vitals, medication, labs, and preventive health in one secure platform.",
};

export default function MarketingHomePage() {
  return (
    <>
      <Section className="overflow-hidden pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-green">
            Clinician-led health monitoring
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl lg:text-6xl">
            Care that stays with you.
          </h1>
          <p className="mt-4 font-heading text-xl text-charcoal-ink/80 sm:text-2xl">
            Clinician-led health monitoring for you, your parents, and your loved ones.
          </p>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Track blood pressure, blood sugar, medication, lab checks, and preventive health needs
            in one secure platform. Tarragon helps families stay informed and supports escalation
            when closer care is needed.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">Start monitoring</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.contact}>Join the 90-Day Health Reset</Link>
            </Button>
          </div>
        </div>
        <ContinuityPath />
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="The problem"
          title="Chronic disease is poorly followed up between doctor visits"
          description="Families worry because readings drift, medication gets missed, and preventive checks slip — with no one watching consistently in between."
        />
      </Section>

      <Section>
        <SectionHeading
          eyebrow="The solution"
          title="Tarragon monitors, reminds, reviews, coordinates, and escalates"
          description="A clinician-led team keeps watch over your health record — calm follow-up when things are steady, escalation when they are not."
        />
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Services" title="What we help you manage" />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICE_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="How it works" title="From sign-up to family updates" />
        <ol className="mx-auto grid max-w-3xl gap-4">
          {HOW_IT_WORKS_STEPS.map(({ step, title, body }) => (
            <li
              key={step}
              className="flex gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-5"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-clinical-navy text-sm font-semibold text-white"
                aria-hidden
              >
                {step}
              </span>
              <div>
                <h3 className="font-heading font-semibold text-charcoal-ink">{title}</h3>
                <p className="mt-1 text-sm text-charcoal-ink/70">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section variant="navy">
        <SectionHeading
          invert
          eyebrow="Why trust us"
          title="Clinician-led, protocol-driven, evidence-focused"
          description="We are not a wellness app. Tarragon is built for the care between doctor visits — with nurses who know your name and protocols that keep follow-up consistent."
        />
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Who it's for" title="Built for families, employers, and HMOs" />
        <div className="grid gap-6 md:grid-cols-3">
          {AUDIENCE_BLOCKS.map((block) => (
            <div
              key={block.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <p className="text-sm font-medium text-brand-green">{block.title}</p>
              <h3 className="mt-2 font-heading text-lg font-semibold text-charcoal-ink">
                {block.message}
              </h3>
              <p className="mt-3 text-sm text-charcoal-ink/70">{block.body}</p>
              {block.cta ? (
                <p className="mt-4 text-sm text-charcoal-ink/50">
                  {block.cta.label} — contact page coming soon
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <CtaBand
          title="Simple, transparent pricing"
          description="See what's included in each plan — no hidden costs."
          primaryHref={MARKETING_ROUTES.pricing}
          primaryLabel="View pricing"
          secondaryHref="/signup"
          secondaryLabel="Start monitoring"
        />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          title="Care that stays with you."
          description="Start monitoring today — for yourself or someone you love."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
        />
      </Section>
    </>
  );
}
