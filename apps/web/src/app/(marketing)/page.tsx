import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ContinuityPath } from "./_components/continuity-path";
import { CtaBand } from "./_components/cta-band";
import { MarketingHero } from "./_components/marketing-hero";
import { MarketingMediaFrame } from "./_components/marketing-media-frame";
import { MarketingVideo } from "./_components/marketing-video";
import { Section, SectionHeading } from "./_components/section";
import { StoryPanel } from "./_components/story-panel";
import { WhatsappHeroMockup } from "./_components/whatsapp-hero-mockup";
import { EmergencyNotice } from "./_components/emergency-notice";
import { MARKETING_MEDIA } from "./_content/media";
import { PREVENTION_CALLOUT, PROOF_STATS, WHAT_YOU_GET } from "./_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "TarragonHealth | Care that stays with you",
  description:
    "Health monitoring for chronic disease, preventive health, and care coordination. Track vitals, medication, labs, and preventive checks in one secure platform.",
  alternates: { canonical: "/" },
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
            Health monitoring for chronic disease, prevention, and care coordination.
          </p>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            Track blood pressure, blood sugar, medication, lab checks, and preventive health needs
            in one secure platform, with clinical review and escalation when closer care is needed.
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
        <SectionHeading
          eyebrow="The solution"
          title="Tarragon monitors, reminds, reviews, coordinates, and escalates"
          description="Your care team keeps watch over your health record: calm follow-up when things are steady, escalation when they are not. See how it works, end to end, on our services page."
        />
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href={MARKETING_ROUTES.services}>See how Tarragon works</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={MARKETING_ROUTES.about}>About Tarragon</Link>
          </Button>
        </div>
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
            <div
              key={pillar.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-green/30 hover:shadow-md"
            >
              <h3 className="font-heading text-xl font-semibold text-charcoal-ink">
                {pillar.title}
              </h3>
              <p className="mt-3 text-charcoal-ink/70">{pillar.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Explore"
          title="Find the care that fits you"
          description="Whether you're managing a condition, staying ahead of one, or looking after someone else, there's a place to start."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            {
              href: MARKETING_ROUTES.services,
              title: "Services",
              body: "Everything Tarragon helps you manage, and how it fits together.",
            },
            {
              href: MARKETING_ROUTES.whoItsFor,
              title: "Who it's for",
              body: "For you, for families, for employers, and for HMOs.",
            },
            {
              href: MARKETING_ROUTES.pricing,
              title: "Pricing",
              body: "Clear plans with no hidden costs. See what's included.",
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-xl border border-charcoal-ink/10 bg-white p-6 transition-colors hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            >
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink group-hover:text-brand-green">
                {item.title}
                <span aria-hidden className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </Link>
          ))}
        </div>
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
