import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AudienceTabs } from "./_components/audience-tabs";
import { ContinuityPath } from "./_components/continuity-path";
import { CtaBand } from "./_components/cta-band";
import { DashboardPreview } from "./_components/dashboard-preview";
import { MarketingHero } from "./_components/marketing-hero";
import { MarketingMediaFrame } from "./_components/marketing-media-frame";
import { MarketingVideo } from "./_components/marketing-video";
import { Section, SectionHeading } from "./_components/section";
import { ServiceCardLink } from "./_components/service-card";
import { StoryPanel } from "./_components/story-panel";
import { TrustPillars } from "./_components/trust-pillars";
import { WhatsappHeroMockup } from "./_components/whatsapp-hero-mockup";
import { EmergencyNotice } from "./_components/emergency-notice";
import { MARKETING_MEDIA } from "./_content/media";
import {
  AUDIENCE_TABS,
  HOMEPAGE_FAQS,
  HOW_IT_WORKS_STEPS,
  PREVENTION_CALLOUT,
  PROOF_STATS,
  SERVICE_CARDS,
  WHAT_YOU_GET,
} from "./_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "TarragonHealth | Care that stays with you",
  description:
    "Health monitoring for you, your parents, and your loved ones. Track vitals, medication, labs, and preventive health in one secure platform.",
};

export default function MarketingHomePage() {
  const { homepage } = MARKETING_MEDIA;
  const { walkthroughVideo } = homepage;

  return (
    <>
      <Section className="relative overflow-hidden pt-16 sm:pt-24">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-brand-green/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 top-10 -z-10 h-[320px] w-[320px] rounded-full bg-sprout-gold/15 blur-3xl"
        />
        <MarketingHero media={homepage.hero} visual={<WhatsappHeroMockup />}>
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Continuity, not just monitoring
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl lg:text-6xl">
            Care that stays with you.
          </h1>
          <p className="mt-4 font-heading text-xl text-charcoal-ink/80 sm:text-2xl">
            Health monitoring for you, your parents, and your loved ones.
          </p>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Track blood pressure, blood sugar, medication, lab checks, and preventive health needs
            in one secure platform. Tarragon helps families stay informed and supports escalation
            when closer care is needed.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <Button asChild size="lg">
              <Link href="/signup">Start monitoring</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.contact}>Join the 90-Day Health Reset</Link>
            </Button>
          </div>
        </MarketingHero>
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
        <StoryPanel
          eyebrow="The problem"
          title="Chronic disease is poorly followed up between doctor visits"
          description="Families worry because readings drift, medication gets missed, and preventive checks slip, with no one watching consistently in between."
          media={homepage.problem}
        />
      </Section>

      <Section>
        <StoryPanel
          eyebrow="The solution"
          title="Tarragon monitors, reminds, reviews, coordinates, and escalates"
          description="Your care team keeps watch over your health record: calm follow-up when things are steady, escalation when they are not."
          media={homepage.solution}
          reverse
        >
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link href={MARKETING_ROUTES.about}>How Tarragon works</Link>
            </Button>
          </div>
        </StoryPanel>
      </Section>

      <Section variant="sage">
        <MarketingVideo
          youtubeId={walkthroughVideo.youtubeId}
          title={walkthroughVideo.title}
          caption={walkthroughVideo.caption}
          poster={walkthroughVideo.poster}
        />
      </Section>

      <Section>
        <div className="mx-auto grid max-w-5xl overflow-hidden rounded-2xl border border-brand-green/20 bg-white shadow-sm lg:grid-cols-[0.9fr_1.1fr]">
          <MarketingMediaFrame
            media={{ illustration: "prevention", imageAlt: "Preventive health and screening follow-up" }}
            className="rounded-none border-0 shadow-none lg:min-h-full"
          />
          <div className="p-8 sm:p-10">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
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
        <ol className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      <Section variant="navy">
        <SectionHeading
          invert
          eyebrow="Why families trust Tarragon"
          title="A doctor who knows your name. Not a hospital PA system."
          description="We are not a wellness app. Tarragon is built for the care between doctor visits — protocol-driven, evidence-focused, and consistent."
        />
        <TrustPillars />
        <div className="mt-10 text-center">
          <Link
            href={MARKETING_ROUTES.about}
            className="inline-flex items-center gap-1.5 font-medium text-white underline underline-offset-4 hover:text-white/80"
          >
            Read our story
            <span aria-hidden>→</span>
          </Link>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Who it's for" title="Whoever you're looking after, Tarragon speaks your language." />
        <AudienceTabs tabs={AUDIENCE_TABS} />
      </Section>

      <Section>
        <CtaBand
          title="Simple, transparent pricing"
          description="See what's included in each plan, with no hidden costs."
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
          description="Clear answers before anyone signs up, because trust starts with knowing what is included."
        />
        <div className="mx-auto grid max-w-4xl gap-4">
          {HOMEPAGE_FAQS.slice(0, 4).map((faq) => (
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
        <p className="mx-auto mt-8 max-w-4xl text-center text-sm text-charcoal-ink/70">
          More questions? See the full breakdown on our{" "}
          <Link href={MARKETING_ROUTES.pricing} className="font-medium text-deep-forest hover:underline">
            pricing page
          </Link>{" "}
          or{" "}
          <Link href={MARKETING_ROUTES.contact} className="font-medium text-deep-forest hover:underline">
            get in touch
          </Link>
          .
        </p>
      </Section>

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Care that stays with you."
          description="Start monitoring today, for yourself or someone you love."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
        />
      </Section>
    </>
  );
}
