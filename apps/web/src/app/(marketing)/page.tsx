import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContinuityPath } from "./_components/continuity-path";
import { CtaBand } from "./_components/cta-band";
import { DashboardPreview } from "./_components/dashboard-preview";
import { Section, SectionHeading } from "./_components/section";
import { ServiceCardLink } from "./_components/service-card";
import {
  AUDIENCE_BLOCKS,
  HOMEPAGE_FAQS,
  HOW_IT_WORKS_STEPS,
  PREVENTION_CALLOUT,
  PROOF_STATS,
  SERVICE_CARDS,
  WHAT_YOU_GET,
} from "./_content/services";
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

      <Section className="py-8 sm:py-10">
        <div className="grid gap-4 rounded-2xl border border-charcoal-ink/10 bg-white p-4 shadow-sm sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          {PROOF_STATS.map((stat) => (
            <div key={stat.label} className="rounded-xl bg-warm-ivory p-5">
              <p className="font-heading text-3xl font-bold text-brand-green">{stat.value}</p>
              <h2 className="mt-1 font-heading text-sm font-semibold uppercase tracking-wide text-charcoal-ink">
                {stat.label}
              </h2>
              <p className="mt-2 text-sm text-charcoal-ink/65">{stat.detail}</p>
            </div>
          ))}
        </div>
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

      <Section>
        <div className="mx-auto max-w-4xl rounded-2xl border border-brand-green/20 bg-white p-8 shadow-sm sm:p-10">
          <p className="text-sm font-medium uppercase tracking-wide text-brand-green">
            Priority programme
          </p>
          <h2 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink sm:text-3xl">
            {PREVENTION_CALLOUT.title}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
            {PREVENTION_CALLOUT.body}
          </p>
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link href={MARKETING_ROUTES.prevention}>Learn about preventive health</Link>
            </Button>
          </div>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="What you get" title="Monitoring that stays connected" />
        <div className="grid gap-6 md:grid-cols-3">
          {WHAT_YOU_GET.map((pillar) => (
            <div key={pillar.title} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <h3 className="font-heading text-xl font-semibold text-charcoal-ink">
                {pillar.title}
              </h3>
              <p className="mt-3 text-charcoal-ink/70">{pillar.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <DashboardPreview />
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
                <Link
                  href={`${block.cta.href}?source=${block.cta.source}`}
                  className="mt-4 inline-flex text-sm font-medium text-brand-green hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 rounded-sm"
                >
                  {block.cta.label} →
                </Link>
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

      <Section variant="sage">
        <SectionHeading
          eyebrow="Questions"
          title="What families usually ask first"
          description="Clear answers before anyone signs up — because trust starts with knowing what is included."
        />
        <div className="mx-auto grid max-w-4xl gap-4">
          {HOMEPAGE_FAQS.map((faq) => (
            <details
              key={faq.question}
              className="group rounded-xl border border-charcoal-ink/10 bg-white p-5"
            >
              <summary className="cursor-pointer list-none font-heading text-lg font-semibold text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2">
                {faq.question}
                <span className="float-right ml-4 text-brand-green transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-charcoal-ink/70">{faq.answer}</p>
            </details>
          ))}
        </div>
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
